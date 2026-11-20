"""Проверки RBAC-матрицы и контракта.

Тесты не ходят в БД: проверяются зависимости ролей и сгенерированный
OpenAPI. Для каждой группы ролей есть минимум один allow и один deny.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

from mayprogulka.entrypoint import app
from mayprogulka.routes.v1.auth.service import (
    require_admin,
    require_marker,
    require_organizer,
    require_registrar,
    require_typist,
    require_user,
)


def user_with_role(role: str):
    return SimpleNamespace(id=1, role=role)


class RoleMatrixTests(unittest.IsolatedAsyncioTestCase):
    async def assert_allowed(self, dependency, role: str) -> None:
        result = await dependency(user_with_role(role))
        self.assertEqual(result.role, role)

    async def assert_denied(self, dependency, role: str) -> None:
        with self.assertRaises(HTTPException) as context:
            await dependency(user_with_role(role))
        self.assertEqual(context.exception.status_code, 403)

    async def test_user_group(self) -> None:
        await self.assert_allowed(require_user, "user")
        await self.assert_denied(require_user, "organizer")
        await self.assert_allowed(require_user, "admin")

    async def test_typist_group(self) -> None:
        await self.assert_allowed(require_typist, "typist")
        await self.assert_denied(require_typist, "organizer")
        await self.assert_allowed(require_typist, "admin")

    async def test_registrar_group(self) -> None:
        await self.assert_allowed(require_registrar, "registrar")
        await self.assert_denied(require_registrar, "marker")
        await self.assert_allowed(require_registrar, "organizer")
        await self.assert_allowed(require_registrar, "admin")

    async def test_marker_group(self) -> None:
        await self.assert_allowed(require_marker, "marker")
        await self.assert_denied(require_marker, "registrar")
        await self.assert_allowed(require_marker, "organizer")
        await self.assert_allowed(require_marker, "admin")

    async def test_organizer_group(self) -> None:
        await self.assert_allowed(require_organizer, "organizer")
        await self.assert_denied(require_organizer, "marker")
        await self.assert_allowed(require_organizer, "admin")

    async def test_admin_group(self) -> None:
        await self.assert_allowed(require_admin, "admin")
        await self.assert_denied(require_admin, "organizer")
        await self.assert_denied(require_admin, "participant")


class OpenApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = app.openapi()

    def test_rbac_document_and_user_role(self) -> None:
        self.assertIn("x-rbac", self.schema)
        self.assertEqual(
            self.schema["x-rbac"]["roles"],
            ["user", "typist", "registrar", "marker", "organizer", "admin"],
        )
        self.assertIn("UserRole", self.schema["components"]["schemas"])
        role_ref = self.schema["components"]["schemas"]["TokenResponse"][
            "properties"
        ]["role"]
        self.assertEqual(role_ref["$ref"], "#/components/schemas/UserRole")

    def test_self_scan_requires_participant_id(self) -> None:
        request = self.schema["components"]["schemas"]["SelfScanRequest"]
        self.assertIn("participant_id", request["required"])

    def test_every_operation_has_x_roles_and_security(self) -> None:
        for path, item in self.schema["paths"].items():
            for method, operation in item.items():
                if not isinstance(operation, dict) or "responses" not in operation:
                    continue
                with self.subTest(method=method, path=path):
                    self.assertIn("x-roles", operation)
                    roles = operation["x-roles"]
                    self.assertTrue(roles)
                    if roles != ["public"]:
                        self.assertTrue(operation.get("security"))
                        self.assertIn("401", operation["responses"])
                        self.assertIn("403", operation["responses"])
                    for code in ("404", "409", "422"):
                        self.assertIn(code, operation["responses"])
                    self.assertEqual(
                        operation["responses"]["422"]["content"]["application/json"][
                            "schema"
                        ]["$ref"],
                        "#/components/schemas/ValidationFailed",
                    )

    def test_expected_endpoints_and_roles(self) -> None:
        expected = {
            ("get", "/api/v1/participants/my"): ["user", "admin"],
            ("get", "/api/v1/participants/{participant_id}"): [
                "user",
                "organizer",
                "admin",
            ],
            ("put", "/api/v1/participants/{participant_id}"): ["user", "admin"],
            ("get", "/api/v1/registrar/search"): [
                "registrar",
                "organizer",
                "admin",
            ],
            ("post", "/api/v1/registrar/issue-card"): [
                "registrar",
                "organizer",
                "admin",
            ],
            ("put", "/api/v1/typist/paper-form/{participant_id}"): [
                "typist",
                "admin",
            ],
            ("get", "/api/v1/marker/checkpoints"): [
                "marker",
                "organizer",
                "admin",
            ],
            ("post", "/api/v1/organizer/checkpoints/{checkpoint_id}/assign"): [
                "organizer",
                "admin",
            ],
            ("delete", "/api/v1/organizer/checkpoints/{checkpoint_id}/assign/{user_id}"): [
                "organizer",
                "admin",
            ],
            ("get", "/api/v1/admin/users"): ["organizer", "admin"],
            ("patch", "/api/v1/admin/users/{user_id}/role"): [
                "organizer",
                "admin",
            ],
            ("get", "/api/v1/admin/maps/{barcode}"): [
                "admin",
                "organizer",
                "registrar",
            ],
            ("post", "/api/v1/scans/self"): ["user", "admin"],
        }
        for (method, path), roles in expected.items():
            with self.subTest(method=method, path=path):
                self.assertEqual(self.schema["paths"][path][method]["x-roles"], roles)

    def test_pagination_fields_present(self) -> None:
        schemas = self.schema["components"]["schemas"]
        for name in (
            "ParticipantListResponse",
            "OrganizerParticipantListResponse",
            "RegistrarFormListResponse",
            "UnlinkedMapListResponse",
            "UserListResponse",
        ):
            with self.subTest(schema=name):
                properties = schemas[name]["properties"]
                self.assertIn("total", properties)
                self.assertIn("limit", properties)
                self.assertIn("offset", properties)

    def test_contract_file_matches_app(self) -> None:
        contract_path = (
            Path(__file__).resolve().parents[1]
            / "contracts"
            / "openapi.current.json"
        )
        contract = json.loads(contract_path.read_text(encoding="utf-8"))

        def signature(schema: dict) -> dict:
            result = {}
            for path, item in schema["paths"].items():
                for method, operation in item.items():
                    if not isinstance(operation, dict) or "responses" not in operation:
                        continue
                    result[(path, method)] = {
                        "x-roles": operation.get("x-roles"),
                        "responses": sorted(operation.get("responses", {})),
                    }
            return result

        self.assertEqual(signature(self.schema), signature(contract))
        self.assertEqual(self.schema.get("x-rbac"), contract.get("x-rbac"))


if __name__ == "__main__":
    unittest.main()

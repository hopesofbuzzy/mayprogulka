"""Дополнение OpenAPI общими RBAC-правилами и ответами.

FastAPI не умеет описывать иерархию ролей и единые ответы 401/403/404/409
из коробки, поэтому схема дополняется централизованно. Это гарантирует,
что `app.openapi()` и зафиксированный контракт совпадают.
"""

from mayprogulka.database.enums import Role

COMMON_SCHEMAS: dict[str, dict] = {
    "Unauthorized": {
        "type": "object",
        "properties": {"detail": {"type": "string"}},
        "required": ["detail"],
        "title": "Unauthorized",
    },
    "Forbidden": {
        "type": "object",
        "properties": {"detail": {"type": "string"}},
        "required": ["detail"],
        "title": "Forbidden",
    },
    "NotFound": {
        "type": "object",
        "properties": {"detail": {"type": "string"}},
        "required": ["detail"],
        "title": "NotFound",
    },
    "Conflict": {
        "type": "object",
        "properties": {"detail": {"type": "string"}},
        "required": ["detail"],
        "title": "Conflict",
    },
    "ValidationFailed": {
        "type": "object",
        "properties": {
            "detail": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "loc": {"type": "array", "items": {"type": "string"}},
                        "msg": {"type": "string"},
                        "type": {"type": "string"},
                    },
                },
            }
        },
        "required": ["detail"],
        "title": "ValidationFailed",
    },
}

COMMON_ERROR_RESPONSES: dict[str, dict] = {
    "401": {
        "description": "Unauthorized",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/Unauthorized"}
            }
        },
    },
    "403": {
        "description": "Forbidden",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/Forbidden"}
            }
        },
    },
    "404": {
        "description": "Not Found",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/NotFound"}
            }
        },
    },
    "409": {
        "description": "Conflict",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/Conflict"}
            }
        },
    },
    "422": {
        "description": "Validation Failed",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/ValidationFailed"}
            }
        },
    },
}

RBAC_DOCUMENT = {
    "roles": [role.value for role in Role],
    "hierarchy": {"admin": ["organizer"]},
    "dependencies": {
        "user": ["user", "admin"],
        "typist": ["typist", "admin"],
        "registrar": ["registrar", "organizer", "admin"],
        "marker": ["marker", "organizer", "admin"],
        "organizer": ["organizer", "admin"],
        "admin": ["admin"],
    },
}


def _rename_role_schema(node):
    """Переименовать Role -> UserRole и обновить все $ref."""

    if isinstance(node, dict):
        for key, value in list(node.items()):
            if key == "$ref" and value == "#/components/schemas/Role":
                node[key] = "#/components/schemas/UserRole"
            else:
                _rename_role_schema(value)
    elif isinstance(node, list):
        for item in node:
            _rename_role_schema(item)


def augment_openapi(schema: dict) -> dict:
    """Добавить x-rbac, общие схемы и ответы ко всем операциям."""

    schema["x-rbac"] = RBAC_DOCUMENT

    components = schema.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    if "Role" in schemas:
        schemas["UserRole"] = schemas.pop("Role")

    _rename_role_schema(schema)
    schemas.update(COMMON_SCHEMAS)

    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            if not isinstance(operation, dict) or "responses" not in operation:
                continue

            roles = operation.get("x-roles", [])
            is_public = roles == ["public"]

            responses = operation.setdefault("responses", {})
            responses["422"] = COMMON_ERROR_RESPONSES["422"]
            if not is_public:
                responses.setdefault("401", COMMON_ERROR_RESPONSES["401"])
                responses.setdefault("403", COMMON_ERROR_RESPONSES["403"])
            responses.setdefault("404", COMMON_ERROR_RESPONSES["404"])
            responses.setdefault("409", COMMON_ERROR_RESPONSES["409"])

    return schema

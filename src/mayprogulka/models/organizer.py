from typing import Optional

from pydantic import BaseModel


class StatsTotals(BaseModel):
    registered: int
    paid: int
    started: int
    finished: int
    on_route: int


class RouteStats(StatsTotals):
    route_id: int
    route_name: str


class CheckpointStats(BaseModel):
    checkpoint_id: int
    route_id: int
    route_name: str
    name: str
    position: int
    passed: int


class EventStatsResponse(BaseModel):
    totals: StatsTotals
    routes: list[RouteStats]
    checkpoints: list[CheckpointStats]


class OrganizerParticipantItem(BaseModel):
    participant_id: int
    form_id: str
    surname: str
    name: str
    middle_name: Optional[str] = None
    route_id: int
    route_name: str
    payment_status: str
    has_started: bool
    has_finished: bool
    map_barcode: Optional[str] = None
    user_id: Optional[int] = None
    phone_number: str
    email: str


class OrganizerParticipantListResponse(BaseModel):
    participants: list[OrganizerParticipantItem]
    total: int
    limit: int
    offset: int


class CheckpointAssignRequest(BaseModel):
    """Назначение маркера на контрольный пункт."""

    user_id: int


class CheckpointAssignmentResponse(BaseModel):
    id: int
    checkpoint_id: int
    user_id: int

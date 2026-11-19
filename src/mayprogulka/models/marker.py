from pydantic import BaseModel


class MarkerCheckpointItem(BaseModel):
    """Назначенный маркеру контрольный пункт."""

    checkpoint_id: int
    route_id: int
    route_name: str
    name: str
    address: str
    coordinates: str
    order: int
    is_start: bool
    is_finish: bool


class MarkerAssignmentsResponse(BaseModel):
    """Список КП, доступных маркеру."""

    marker_id: int
    checkpoints: list[MarkerCheckpointItem]


class MarkerListItem(BaseModel):
    """Маркер в списке организатора."""

    user_id: int
    username: str
    email: str
    is_active: bool
    checkpoints_count: int


class MarkerListResponse(BaseModel):
    markers: list[MarkerListItem]


class MarkerAssignmentUpdate(BaseModel):
    """Полная замена набора КП, назначенных маркеру."""

    checkpoint_ids: list[int]

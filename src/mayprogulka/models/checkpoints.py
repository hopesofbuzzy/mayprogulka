from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class CheckpointCreateRequest(BaseModel):
    route_id: int
    name: str
    address: str
    coordinates: str
    order: int
    is_start: bool = False
    is_finish: bool = False


class CheckpointUpdateRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    coordinates: Optional[str] = None
    order: Optional[int] = None
    is_start: Optional[bool] = None
    is_finish: Optional[bool] = None


class CheckpointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    route_id: int
    name: str
    address: str
    coordinates: str
    order: int
    is_start: bool
    is_finish: bool


class CheckpointListResponse(BaseModel):
    checkpoints: list[CheckpointResponse]


class BatchCheckpointCreateRequest(BaseModel):
    route_id: int
    checkpoints: list[CheckpointCreateRequest]


class BatchCheckpointResponse(BaseModel):
    created_count: int
    errors: list[dict]
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class CheckpointCreateRequest(BaseModel):
    route_id: int
    name: str
    address: str
    coordinates: str


class CheckpointUpdateRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    coordinates: Optional[str] = None
    position: Optional[int] = None


class CheckpointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    barcode: str
    route_id: int
    name: str
    address: str
    coordinates: str
    position: int


class CheckpointListResponse(BaseModel):
    checkpoints: list[CheckpointResponse]

class CheckpointCreateItemRequest(BaseModel):
    name: str
    address: str
    coordinates: str

class BatchCheckpointCreateRequest(BaseModel):
    route_id: int
    checkpoints: list[CheckpointCreateItemRequest]



class BatchCheckpointResponse(BaseModel):
    created_count: int
    errors: list[dict]

class CheckpointBarcodeResponse(BaseModel):
    ...
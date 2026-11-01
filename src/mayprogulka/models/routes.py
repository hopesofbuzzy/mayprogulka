from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class RouteCreateRequest(BaseModel):
    year: int
    name: str
    distance: float
    description: Optional[str] = None
    is_active: bool = True


class RouteUpdateRequest(BaseModel):
    name: Optional[str] = None
    distance: Optional[float] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    map_url: Optional[str] = None


class RouteResponse(BaseModel):
    id: int
    year: int
    name: str
    distance: float
    description: Optional[str] = None
    is_active: bool
    map_url: Optional[str] = None

    class Config:
        from_attributes = True


class RouteListResponse(BaseModel):
    routes: list[RouteResponse]


class MapUploadResponse(BaseModel):
    map_url: str
from pydantic import BaseModel, EmailStr, Field

from mayprogulka.database.enums import Role


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)

class LoginRequest(BaseModel):
    username: str # Или email, как тебе удобнее
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: Role


class MeResponse(BaseModel):
    user_id: int
    username: str
    email: EmailStr
    role: Role
    is_active: bool

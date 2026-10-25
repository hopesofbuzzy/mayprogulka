from pydantic import BaseModel, EmailStr, Field

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
    role: str
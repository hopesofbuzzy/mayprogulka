# routes/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select


from mayprogulka.database.database import get_db
from mayprogulka.database.models import User
from mayprogulka.database.enums import Role
from .service import get_password_hash, verify_password, create_access_token, get_current_user
from ....models.auth import RegisterRequest, LoginRequest, TokenResponse, MeResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=201,
    openapi_extra={"x-roles": ["public"]},
)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # 1. Проверяем, нет ли уже такого юзера
    result = await db.execute(
        select(User).where((User.email == data.email) | (User.username == data.username))
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email или логин уже зарегистрирован")
        
    # 2. Создаем юзера с базовой ролью user
    new_user = User(
        username=data.username,
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=Role.USER.value,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    # 3. Выдаем токен
    token = create_access_token({"user_id": new_user.id})
    return TokenResponse(access_token=token, user_id=new_user.id, role=new_user.role)

@router.post(
    "/login",
    response_model=TokenResponse,
    openapi_extra={"x-roles": ["public"]},
)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    # 1. Ищем юзера
    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()
    
    # 2. Проверяем пароль
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        
    # 3. Выдаем токен
    token = create_access_token({"user_id": user.id})
    return TokenResponse(access_token=token, user_id=user.id, role=user.role)

@router.get(
    "/me",
    response_model=MeResponse,
    openapi_extra={
        "x-roles": [
            "user",
            "typist",
            "registrar",
            "marker",
            "organizer",
            "admin",
        ]
    },
)
async def get_me(current_user: User = Depends(get_current_user)):
    """Проверка: работает ли защита. Доступно только с токеном."""
    return MeResponse(
        user_id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        role=current_user.role,
        is_active=current_user.is_active,
    )
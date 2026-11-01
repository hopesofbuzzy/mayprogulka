# auth.py
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database.database import get_db
from database.models import User

# Настройки (в реальном проекте бери из .env!)
SECRET_KEY = "super-secret-key-change-me-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # Токен живет 24 часа

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# --- Утилиты ---
def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # Сохраняем user_id в стандартное поле "sub" (subject)
    to_encode.update({"exp": expire, "sub": str(to_encode.get("user_id"))})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# --- Зависимость для защиты роутов ---
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    token = credentials.credentials
    
    try:
        # 1. Декодируем токен
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str: str = payload.get("sub")
        
        if user_id_str is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные (отсутствует ID)",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # JWT хранит всё как строки, преобразуем обратно в int для БД
        user_id = int(user_id_str)
        
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверные учетные данные (ошибка токена)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 2. Ищем пользователя в БД
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    # 3. Проверяем, что пользователь существует и активен
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Пользователь не найден или неактивен",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    return user

def require_role(required_role: str):
    """
    Зависимость для проверки конкретной роли.
    Использование: Depends(require_role("admin"))
    """
    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Доступ запрещен. Требуется роль: {required_role}"
            )
        return current_user
    return role_checker


# Готовые зависимости для каждой роли
require_participant = require_role("participant")
require_organizer = require_role("organizer")
require_typist = require_role("typist")
require_admin = require_role("admin")
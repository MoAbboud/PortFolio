"""Auth routes — thin controllers that delegate to ``AuthService``."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import AuthServiceDep, CurrentUser
from app.schemas.token import Token
from app.schemas.user import UserCreate, UserLogin, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new account",
)
def register(data: UserCreate, service: AuthServiceDep) -> UserRead:
    user = service.register(data)
    return UserRead.model_validate(user)


@router.post("/login", response_model=Token, summary="Log in and receive a token")
def login(data: UserLogin, service: AuthServiceDep) -> Token:
    user = service.authenticate(data.email, data.password)
    return Token(access_token=service.issue_token(user))


@router.get("/me", response_model=UserRead, summary="Current authenticated user")
def me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)

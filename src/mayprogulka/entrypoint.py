# Заглушечное приложение на FastAPI

from typing import Annotated

from fastapi import FastAPI, Depends
from pydantic import BaseModel, Field
from module.extension import prints

app = FastAPI()

async def common_parameters(
    q: str | None = None,
    skip: int = 0,
    limit: int = -1
):
    return {"q": q, "skip": skip, "limit": limit}

@app.get("/items/")
async def get_items(commons: Annotated[dict, Depends(common_parameters)]):
    prints()
    return commons

@app.get("/users/")
async def get_users(commons: Annotated[dict, Depends(common_parameters)]):
    return commons
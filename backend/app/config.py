from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env from project root so the settings work regardless of CWD
# (alembic, uvicorn, and pytest all run from different directories)
load_dotenv(Path(__file__).parents[2] / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )

    DATABASE_URL: str
    REDIS_URL: str
    WORKSPACE_BASE_PATH: str
    VINA_PATH: str = "/usr/local/bin/vina"
    SECRET_KEY: str
    DEBUG: bool = False

    @field_validator("WORKSPACE_BASE_PATH")
    @classmethod
    def must_be_absolute(cls, v: str) -> str:
        if not v.startswith("/"):
            raise ValueError("WORKSPACE_BASE_PATH must be an absolute path")
        return v.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()

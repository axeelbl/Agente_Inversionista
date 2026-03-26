import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.backend.Bots.chat_routes import router as chat_router
from app.backend.core.cors import setup_cors
from app.backend.core.security import setup_security
from app.backend.core.startup import init_services

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))


def create_app() -> FastAPI:
    app = FastAPI(title="AI News Anchor API", version="2.0")

    setup_security(app)
    init_services()

    app.include_router(chat_router)

    setup_cors(app)

    app.mount(
        "/static",
        StaticFiles(directory=os.path.join(BASE_DIR, "frontend")),
        name="static",
    )

    @app.get("/")
    async def root():
        index_path = os.path.join(BASE_DIR, "frontend", "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"error": "Archivo index.html no encontrado."}

    return app

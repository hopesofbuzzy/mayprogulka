# # 2. Использование в эндпоинте (в файле routes.py) 
# from fastapi import APIRouter, Depends
# from sqlalchemy.ext.asyncio import AsyncSession
# from sqlalchemy import select
# from database.database import get_db

# router = APIRouter()

# @router.post("/scan")
# async def scan_barcode(barcode: str, db: AsyncSession = Depends(get_db)):
#     # Ищем участника по штрих-коду
#     result = await db.execute(
#         select(Participant).where(Participant.barcode == barcode)
#     )
#     participant = result.scalar_one_or_none()
    
#     if not participant:
#         return {"error": "Участник не найден"}
    
#     # Логируем прохождение КП
#     scan_log = ScanLog(participant_id=participant.id, checkpoint_id=1)
#     db.add(scan_log)
#     await db.commit()
    
#     return {"status": "ok", "participant": participant.name}

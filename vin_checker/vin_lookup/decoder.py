"""Обратная совместимость: реэкспорт сервиса поиска."""

from .models import GibddChecks, VehicleInfo
from .service import lookup_batch, lookup_vin

__all__ = ["VehicleInfo", "GibddChecks", "lookup_vin", "lookup_batch"]

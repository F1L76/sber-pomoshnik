# ponytail: smoke — вид стоимости берём из «Вид оценочной стоимости», не угадываем
from collections import Counter
from zalog_converter.asz_xlsx import extract_valuation_type, normalize_valuation_type
from zalog_converter.xlsx_extract import parse_xlsx

assert normalize_valuation_type("Рыночная") == "Рыночная"
assert normalize_valuation_type("кадастровая") == "Кадастровая"
assert normalize_valuation_type("Прочая;") == "Прочая"
assert normalize_valuation_type("Балансовая") == "Балансовая"
assert extract_valuation_type("Вид оценочной стоимости: Кадастровая; Площадь: 10") == "Кадастровая"
assert extract_valuation_type("foo") == ""

result = parse_xlsx("Перечень ОЗ ASZ0001234567-2.xlsx")
counts = Counter(o.valuation_type for o in result.objects)
assert counts.get("Кадастровая", 0) >= 1, counts
assert counts.get("Рыночная", 0) >= 1, counts
assert "Льготная" not in counts or counts["Льготная"] == 0
# раньше почти всё было «Рыночная» при cost>0
assert counts.get("Рыночная", 0) < len(result.objects), counts
print("ok:", dict(counts))

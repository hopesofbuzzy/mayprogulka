# -*- coding: utf-8 -*-
"""A/B-сравнение: main (results_main.json) vs feature-ветка (results.json).

Запуск: .venv-ocr/Scripts/python -X utf8 benchmark/compare_ab.py
Выход:  benchmark/report_ab.md
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from benchmark.ground_truth import REAL_PHOTOS
from benchmark.run_benchmark import FIELD_ORDER, compare_real

MAIN = "benchmark/results_main.json"
BRANCH = "benchmark/results.json"
OUT = "benchmark/report_ab.md"


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    a = load(MAIN)
    b = load(BRANCH)

    # --- реальные фото ---
    a_real = a.get("real")
    a_real["template"] = "black_squares"
    a_real["gt_form"] = REAL_PHOTOS[0]["form"]
    a_cmp = compare_real(a_real)

    b_reals = [(d, compare_real(d)) for d in b.get("reals", [])]
    b_by_template = {d.get("template"): (d, compare_real(d)) for d, _ in b_reals}

    L = []
    L.append("# A/B: main → feature/ai-ocr-model (коммит c1db1ad)\n")
    L.append("*Один и тот же бенчмарк, seed=42: 2 реальных фото + 36 синтетических анкет (mild/medium/hard).*\n")

    L.append("\n## 1. Реальное фото, шаблон с чёрными квадратами (20261127_212948.jpg)\n")
    L.append("| Поле | Эталон | Main | Ветка | Main | → | Ветка |")
    L.append("|---|---|---|---|---|---|---|")
    b_cmp = b_by_template.get("black_squares", (None, None))[1] or a_cmp
    for i, r_a in enumerate(a_cmp["fields"]):
        r_b = b_cmp["fields"][i]
        mark_a = "✅" if r_a["exact"] else "❌"
        mark_b = "✅" if r_b["exact"] else "❌"
        L.append(f"| {r_a['field']} | {r_a['gt']} | {r_a['pred'] or '«пусто»'} | {r_b['pred'] or '«пусто»'} | {mark_a} | → | {mark_b} |")
    L.append(f"\n**Итог: {a_cmp['exact_n']}/{a_cmp['total']} ({a_cmp['accuracy']*100:.0f}%) → {b_cmp['exact_n']}/{b_cmp['total']} ({b_cmp['accuracy']*100:.0f}%)**, статус: {a_cmp['status']} → {b_cmp['status']} (conf {a_cmp['confidence']}% → {b_cmp['confidence']}%)")

    bs = b_by_template.get("aruco")
    if bs:
        d, c = bs
        L.append(f"\n## 2. Реальное фото, ArUco-шаблон v2 (20261127_191952.jpg) — только ветка\n")
        L.append(f"- Выравнивание: **{d.get('align_type')}** · Статус: **{c['status']}** (conf {c['confidence']}%)")
        L.append(f"- Верных полей: **{c['exact_n']}/{c['total']}** ({c['accuracy']*100:.0f}%)\n")
        L.append("| Поле | Эталон | Распознано | Верно |")
        L.append("|---|---|---|---|")
        for r in c["fields"]:
            L.append(f"| {r['field']} | {r['gt']} | {r['pred'] or '«пусто»'} | {'✅' if r['exact'] else '❌'} |")
        cells = d.get("cells", {})
        L.append("\nЯчеек найдено/ожидалось: " + ", ".join(
            f"{k} {v['boxes_found']}/{v['expected_chars']}" for k, v in cells.items()))

    # --- синтетика ---
    sa, sb = a.get("synthetic_aggregated") or {}, b.get("synthetic_aggregated") or {}
    L.append("\n## 3. Синтетика (шрифтовое заполнение + деградации), seed=42\n")
    L.append("| Уровень | Метрика | Main | Ветка | Δ |")
    L.append("|---|---|---|---|---|")
    for lvl, title in (("mild", "Mild"), ("medium", "Medium"), ("hard", "Hard")):
        x, y = sa.get(lvl, {}), sb.get(lvl, {})
        if not x and not y:
            continue
        L.append(f"| {title} | Анкет целиком верны | {x.get('form_accuracy',0)*100:.0f}% | {y.get('form_accuracy',0)*100:.0f}% | {(y.get('form_accuracy',0)-x.get('form_accuracy',0))*100:+.0f} п.п. |")
        L.append(f"| {title} | APPROVED | {x.get('approved_share',0)*100:.0f}% | {y.get('approved_share',0)*100:.0f}% | {(y.get('approved_share',0)-x.get('approved_share',0))*100:+.0f} п.п. |")
        L.append(f"| {title} | Латентность, с | {x.get('latency_mean_s','—')} | {y.get('latency_mean_s','—')} | |")
        for f in FIELD_ORDER:
            fa = x.get("fields", {}).get(f, {}).get("accuracy", 0)
            fb = y.get("fields", {}).get(f, {}).get("accuracy", 0)
            d = (fb - fa) * 100
            if abs(d) >= 1:
                L.append(f"| {title} · {f} | точность поля | {fa*100:.0f}% | {fb*100:.0f}% | {d:+.0f} п.п. |")

    # --- критерии приёмки ---
    y_med = sb.get("medium", {})
    L.append("\n## 4. Критерии приёмки ветки\n")
    L.append("| Критерий | Цель | Факт | Вердикт |")
    L.append("|---|---|---|---|")
    bs_cmp = b_by_template.get("black_squares", (None, None))[1]
    ar_cmp = b_by_template.get("aruco", (None, None))[1]
    for name, target, fact, ok in (
        ("Реальное фото (black_squares)", "≥ 9/11", f"{bs_cmp['exact_n']}/11", bs_cmp["exact_n"] >= 9),
        ("Реальное фото (aruco)", "≥ 9/11", f"{ar_cmp['exact_n']}/11" if ar_cmp else "—", bool(ar_cmp) and ar_cmp["exact_n"] >= 9),
        ("Medium: анкеты целиком верны", "≥ 50%", f"{y_med.get('form_accuracy',0)*100:.0f}%", y_med.get("form_accuracy", 0) >= 0.5),
        ("Medium: ложные пропуски (APPROVED)", "≤ 20%", f"{y_med.get('approved_share',0)*100:.0f}%", y_med.get("approved_share", 1) <= 0.2),
        ("Латентность (hard), с", "≤ 5", f"{sb.get('hard',{}).get('latency_mean_s','—')}", float(sb.get("hard",{}).get('latency_mean_s', 99)) <= 5),
    ):
        L.append(f"| {name} | {target} | {fact} | {'✅' if ok else '⚠️'} |")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("OK:", OUT)


if __name__ == "__main__":
    main()

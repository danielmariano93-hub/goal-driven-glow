from pathlib import Path

p = Path("supabase/functions/_shared/analytics/periodResolver.ts")
text = p.read_text()

replacements = [
    (
        r'const MONTHLY_RATE_RX = /\\b(por mes|ao mes|cada mes)\\b/;',
        r'const MONTHLY_RATE_RX = /\b(por mes|ao mes|cada mes)\b/;',
    ),
    (
        r'const FACTUAL_MONTHLY_VERB_RX = /\\b(gastei|recebi|paguei|desembolsei|foi|ficou|deu|somei|somou|totalizei)\\b/;',
        r'const FACTUAL_MONTHLY_VERB_RX = /\b(gastei|recebi|paguei|desembolsei|foi|ficou|deu|somei|somou|totalizei)\b/;',
    ),
    (
        r'const wantsComplete = /\\b(completos?|fechados?)\\b/.test(t);',
        r'const wantsComplete = /\b(completos?|fechados?)\b/.test(t);',
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"expected escaped regex not found: {old}")
    text = text.replace(old, new, 1)

p.write_text(text)
print("phase1 regex literals normalized")

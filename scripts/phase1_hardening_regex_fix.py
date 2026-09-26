from pathlib import Path

p = Path("supabase/functions/_shared/analytics/periodResolver.ts")
text = p.read_text()

# Regex literals (/\b.../) need one backslash in TS source. RegExp built from a
# string/template needs TWO so JavaScript passes a literal backslash to RegExp.
# The first patch wrote `\b`/`\s` in the template source, which JS interpreted
# as backspace/escape rather than regex word-boundary/whitespace tokens.
old = r'const explicitMonthWindow = t.match(new RegExp(`\bultimos?\s+(${MONTH_COUNT_TOKEN})\s+meses?\b`));'
new = r'const explicitMonthWindow = t.match(new RegExp(`\\bultimos?\\s+(${MONTH_COUNT_TOKEN})\\s+meses?\\b`));'
if old not in text:
    raise SystemExit("expected dynamic month regex not found")
text = text.replace(old, new, 1)

p.write_text(text)
print("phase1 dynamic RegExp escaping normalized")

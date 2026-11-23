# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The company's holiday list (plane.db.models.Holiday): looking days up, and reading a list from a file.

A file is CSV or Excel with a header row naming a date column and a name column (as Keka and most spreadsheets
export them: "Date", "Holiday" / "Name" / "Occasion"), and optionally a type column ("Type", "Optional",
"Floater"). Dates may be 2026-01-14, 14-01-2026, 14/01/2026, 14 Jan 2026, 14-Jan-2026, January 14, 2026 or real
Excel dates; day first when it's ambiguous, as in India.
"""

# Python imports
import csv
import io
import re
from datetime import date, datetime

# Third party imports
from openpyxl import load_workbook

# Module imports
from plane.db.models import Holiday, HolidayKind

MAX_IMPORT_BYTES = 1024 * 1024
MAX_IMPORT_ROWS = 500
NAME_MAX_LENGTH = 100

DATE_FORMATS = (
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%d.%m.%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d-%B-%Y",
    "%d %b, %Y",
    "%d %B, %Y",
    "%b %d %Y",
    "%B %d %Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%Y/%m/%d",
)
# best first
DATE_HEADERS = ("date", "holiday date")
NAME_HEADERS = ("holiday", "holiday name", "name", "occasion", "festival", "title", "description")
TYPE_HEADERS = ("type", "holiday type", "kind", "optional", "floater", "is optional", "is floater", "restricted")
# words in a type column (or a yes/no "Optional" column)
OPTIONAL_WORDS = {"optional", "floater", "floating", "restricted", "yes", "true", "y", "1"}
HOLIDAY_WORDS = {"holiday", "mandatory", "public", "fixed", "national", "company", "regular", "no", "false", "n", "0"}


def holidays_between(workspace_id, from_date, to_date):
    """{date: Holiday} for the days from from_date to to_date (both included), optional ones too."""
    return {
        holiday.date: holiday
        for holiday in Holiday.objects.filter(workspace_id=workspace_id, date__gte=from_date, date__lte=to_date)
    }


def serialize_holiday(holiday):
    return {
        "id": str(holiday.id),
        "date": holiday.date.isoformat(),
        "name": holiday.name,
        "kind": holiday.kind,
        "description": holiday.description,
    }


def parse_date(value):
    """A date from a cell or a string, or None."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return None
    # "Wednesday, 14 January 2026" / "Wed 14 Jan 2026": the weekday adds nothing
    text = re.sub(r"^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+", "", text, flags=re.IGNORECASE)
    # "14th Jan 2026"
    text = re.sub(r"\b(\d{1,2})(st|nd|rd|th)\b", r"\1", text, flags=re.IGNORECASE)
    for pattern in DATE_FORMATS:
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def parse_kind(value):
    """HolidayKind from a type cell ("Optional holiday", "Floater", "Public holiday", "Yes", ...), None if unknown."""
    words = set(re.split(r"[^a-z0-9]+", str(value or "").strip().lower())) - {""}
    if not words:
        return HolidayKind.HOLIDAY
    if words & OPTIONAL_WORDS:
        return HolidayKind.OPTIONAL
    if words & HOLIDAY_WORDS:
        return HolidayKind.HOLIDAY
    return None


def _rows_of(upload):
    """The file's rows as lists of cell values. Raises ValueError with a message for the person."""
    name = (getattr(upload, "name", "") or "").lower()
    content = upload.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise ValueError("The file is too big. Keep it under 1 MB.")
    if name.endswith(".xlsx"):
        try:
            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception:
            raise ValueError("Couldn't read this Excel file. Save it as .xlsx or .csv and try again.")
        sheet = workbook.worksheets[0]
        return [list(row) for row in sheet.iter_rows(values_only=True)]
    if name.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
        return list(csv.reader(io.StringIO(text)))
    raise ValueError("Choose a .csv or .xlsx file.")


def _column(cells, names, taken=()):
    """The first column whose header is one of names (best first), not one of taken."""
    for name in names:
        for index, cell in enumerate(cells):
            if cell == name and index not in taken:
                return index
    return None


def _find_header(rows):
    """(header row index, date column, name column, type column or None), from the first rows."""
    for index, row in enumerate(rows[:10]):
        cells = [re.sub(r"\s+", " ", str(cell or "")).strip().lower() for cell in row]
        date_column = _column(cells, DATE_HEADERS)
        if date_column is None:
            date_column = next((i for i, cell in enumerate(cells) if "date" in cell), None)
        name_column = _column(cells, NAME_HEADERS, taken=(date_column,))
        if date_column is not None and name_column is not None:
            return index, date_column, name_column, _column(cells, TYPE_HEADERS, taken=(date_column, name_column))
    return None


def _cell(row, column):
    return row[column] if column is not None and column < len(row) else None


def read_holiday_file(upload):
    """(holidays, errors) from an uploaded file: holidays as dicts (date, name, kind), errors as
    {"row": <the file's row number>, "error": ...}. Raises ValueError when the file can't be used at all."""
    rows = _rows_of(upload)
    header = _find_header(rows)
    if header is None:
        raise ValueError('Add a header row with a "Date" column and a "Holiday" (or "Name") column.')
    header_index, date_column, name_column, type_column = header

    holidays, errors, seen = [], [], {}
    for number, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        if not any(str(value or "").strip() for value in row):
            continue
        if len(holidays) + len(errors) >= MAX_IMPORT_ROWS:
            raise ValueError(f"The file has more than {MAX_IMPORT_ROWS} holidays. Split it into smaller files.")
        day = parse_date(_cell(row, date_column))
        name = re.sub(r"\s+", " ", str(_cell(row, name_column) or "")).strip()
        kind = parse_kind(_cell(row, type_column))
        if day is None:
            errors.append({"row": number, "error": f'"{_cell(row, date_column) or ""}" isn\'t a date we can read.'})
        elif not name:
            errors.append({"row": number, "error": "The holiday has no name."})
        elif len(name) > NAME_MAX_LENGTH:
            errors.append({"row": number, "error": f"The name is longer than {NAME_MAX_LENGTH} characters."})
        elif kind is None:
            unknown = _cell(row, type_column)
            errors.append({"row": number, "error": f'Type "{unknown}" isn\'t one we know. Use Holiday or Optional.'})
        elif day in seen:
            errors.append({"row": number, "error": f"{day:%d %b %Y} is already on row {seen[day]}."})
        else:
            seen[day] = number
            holidays.append({"date": day, "name": name, "kind": kind})
    return holidays, errors

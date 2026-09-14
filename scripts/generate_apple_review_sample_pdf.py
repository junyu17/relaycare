from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "taskkin-care-review-sample-schedule.pdf"


def build_pdf() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    teal = colors.HexColor("#0F766E")
    dark = colors.HexColor("#172026")
    muted = colors.HexColor("#5F6B73")
    pale = colors.HexColor("#E8F4F1")
    line = colors.HexColor("#D9E1DC")

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="ReviewTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=21,
            leading=25,
            textColor=teal,
            alignment=TA_CENTER,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="ReviewSubtitle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=15,
            textColor=muted,
            alignment=TA_CENTER,
            spaceAfter=16,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Section",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=dark,
            spaceBefore=8,
            spaceAfter=7,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodySmall",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=dark,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Notice",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=14,
            textColor=teal,
            backColor=pale,
            borderColor=teal,
            borderWidth=0.6,
            borderPadding=9,
            spaceAfter=14,
        )
    )

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        rightMargin=0.65 * inch,
        leftMargin=0.65 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
        title="TaskKin Care Review Sample Schedule",
        author="TaskKin Care",
        subject="Fictional non-clinical sample for App Review OCR testing",
    )

    story = [
        Paragraph("TaskKin Care", styles["ReviewTitle"]),
        Paragraph("App Review Sample - Family Coordination Schedule", styles["ReviewSubtitle"]),
        Paragraph(
            "FICTIONAL TEST DATA ONLY. This file contains no diagnosis, medication, insurance, emergency, or other protected health information. It is provided only to demonstrate document selection, on-device OCR, and manual confirmation.",
            styles["Notice"],
        ),
        Paragraph("Upcoming coordination items", styles["Section"]),
    ]

    rows = [
        ["Date and time", "Coordination item", "Owner", "Duration"],
        ["August 18, 2026 - 10:00 AM", "Grocery pickup", "Avery Chen", "30 min"],
        ["August 19, 2026 - 2:30 PM", "Family check-in call", "Morgan Lee", "20 min"],
        ["August 20, 2026 - 9:00 AM", "Transportation confirmation", "Jordan Rivera", "15 min"],
    ]
    table = Table(rows, colWidths=[1.82 * inch, 2.22 * inch, 1.42 * inch, 0.82 * inch], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), teal),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.7),
                ("LEADING", (0, 0), (-1, -1), 11),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (-1, 1), (-1, -1), "CENTER"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7FAF9")]),
                ("GRID", (0, 0), (-1, -1), 0.45, line),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            table,
            Spacer(1, 14),
            Paragraph("Suggested follow-up", styles["Section"]),
            Paragraph(
                "Follow up with Jordan Rivera to confirm transportation by August 19, 2026 at 6:00 PM. Estimated effort: 15 minutes. Priority: normal.",
                styles["BodySmall"],
            ),
            Spacer(1, 12),
            Paragraph("Expected review flow", styles["Section"]),
            Paragraph(
                "In TaskKin Care, open Docs, acknowledge the non-PHI safety notice, choose Upload document, select this PDF, review the locally extracted suggestion and confidence, then tap Confirm and create task. No extracted field becomes a task without explicit confirmation.",
                styles["BodySmall"],
            ),
            Spacer(1, 18),
            Paragraph(
                "TaskKin Care is a family coordination tool. It does not provide diagnosis, treatment, prescription, billing, or emergency guidance.",
                ParagraphStyle(
                    name="FooterNote",
                    parent=styles["BodySmall"],
                    textColor=muted,
                    alignment=TA_CENTER,
                    borderColor=line,
                    borderWidth=0.4,
                    borderPadding=8,
                ),
            ),
        ]
    )

    doc.build(story)


if __name__ == "__main__":
    build_pdf()

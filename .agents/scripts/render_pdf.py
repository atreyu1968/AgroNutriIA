import fitz, sys
doc = fitz.open("attached_assets/Informe_técnico_de_fertirrigación_Bajo_Cuadras_(1)_1785771451635.pdf")
print("pages:", doc.page_count)
for i in range(min(doc.page_count, 6)):
    p = doc[i]
    p.get_pixmap(matrix=fitz.Matrix(2,2)).save(f".agents/outputs/report_p{i+1}.png")

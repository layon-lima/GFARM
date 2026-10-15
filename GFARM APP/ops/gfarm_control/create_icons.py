"""Gera os icones oficiais do GFARM (apenas arquivos ICO, sem distribuir fontes)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent / "build"
OUT.mkdir(parents=True, exist_ok=True)

def icon(name, bg, accent, kind):
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((18, 18, 494, 494), radius=108, fill=bg)
    d.rounded_rectangle((40, 40, 472, 472), radius=94, outline=(255, 255, 255, 45), width=4)
    if kind == "app":
        # G botanico, simples e reconhecivel na barra de tarefas do Windows.
        d.arc((105, 107, 411, 415), 43, 317, fill=(244, 255, 250), width=63)
        d.rounded_rectangle((269, 238, 407, 297), radius=22, fill=(244, 255, 250))
        d.line(((284, 346), (314, 185)), fill=accent, width=12)
        d.ellipse((306, 139, 382, 183), fill=accent)
        d.ellipse((236, 161, 311, 208), fill=accent)
    else:
        d.rounded_rectangle((136, 140, 376, 355), radius=38, outline=(236, 255, 243), width=25)
        for y in (183, 250, 317):
            d.ellipse((172, y - 9, 189, y + 8), fill=accent)
            d.line((221, y, 332, y), fill=(240, 255, 244), width=14)
        d.arc((307, 316, 425, 433), 195, 343, fill=accent, width=27)
        d.ellipse((397, 358, 443, 403), fill=accent)
    path = OUT / name
    img.save(path, format="ICO", sizes=[(16,16),(24,24),(32,32),(48,48),
                                       (64,64),(128,128),(256,256)])
    print(path)

icon("GFARM.ico", (10, 104, 63, 255), (122, 250, 179, 255), "app")
icon("GFARM-Control.ico", (14, 57, 47, 255), (85, 244, 156, 255), "control")

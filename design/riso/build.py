"""Make riso-themed copies of userflow/techstack and screenshot all three images with headless Chrome."""
import os
import subprocess
import tempfile

D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

for f in ("userflow", "techstack"):
    s = open(os.path.join(D, f + ".html"), encoding="utf-8").read()
    s = s.replace("family=Montserrat:wght@600;700;800;900&family=JetBrains+Mono:wght@500;700",
                  "family=Archivo+Black&family=JetBrains+Mono:wght@500;700;800")
    s = s.replace("</head>", '<link rel="stylesheet" href="riso/riso.css" />\n</head>')
    open(os.path.join(D, "riso-" + f + ".html"), "w", encoding="utf-8").write(s)

jobs = [("riso/thumbnail.html", 1280, 720, "riso/thumbnail.png"),
        ("riso-userflow.html", 1920, 1080, "riso/userflow.png"),
        ("riso-techstack.html", 1920, 1080, "riso/techstack.png")]
for src, w, h, out in jobs:
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--user-data-dir=" + tempfile.mkdtemp(), "--virtual-time-budget=8000",
                    f"--window-size={w},{h}", "--screenshot=" + os.path.join(D, out),
                    "file:///" + os.path.join(D, src).replace("\\", "/")], check=True, capture_output=True)
    print("wrote", out)

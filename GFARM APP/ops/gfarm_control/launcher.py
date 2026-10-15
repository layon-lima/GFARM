"""GFARM para Windows: abre a interface como janela de aplicativo Edge."""
from pathlib import Path
import os
import socket
import subprocess
import tkinter
import webbrowser
from tkinter import messagebox

PORT = 8000
CONTROL = "http://127.0.0.1:8787/"


def edge():
    candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)"))
        / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", "C:/Program Files"))
        / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "Microsoft/Edge/Application/msedge.exe",
    ]
    return next((p for p in candidates if p.is_file()), None)


def main():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=2):
            url = "http://127.0.0.1:%s/" % PORT
            browser = edge()
            if browser:
                # App mode: janela propria, sem a interface de abas do navegador.
                subprocess.Popen(
                    [str(browser), "--app=" + url],
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            else:
                webbrowser.open(url)
            return
    except OSError:
        pass
    root = tkinter.Tk()
    root.withdraw()
    if messagebox.askyesno(
        "GFARM", "O servidor GFARM ainda nao esta online.\n\n"
        "Deseja abrir o GFARM Control para ligar o sistema?"
    ):
        webbrowser.open(CONTROL)
    root.destroy()


if __name__ == "__main__":
    main()

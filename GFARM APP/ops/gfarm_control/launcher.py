"""Atalho oficial GFARM para Windows: abre o ERP sem console."""
import socket
import webbrowser
import tkinter
from tkinter import messagebox

PORT = 8000
CONTROL = "http://127.0.0.1:8787/"

def main():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=2):
            webbrowser.open("http://127.0.0.1:%s/" % PORT)
            return
    except OSError:
        pass
    root = tkinter.Tk()
    root.withdraw()
    if messagebox.askyesno(
        "GFARM", "O servidor GFARM ainda nao esta online.\n\n"
        "Deseja abrir o GFARM Control para ligar o sistema?"):
        webbrowser.open(CONTROL)
    root.destroy()

if __name__ == "__main__":
    main()

"""Entry point for the TBM real-time bus/tram companion app.

Kept at the repository root because Buildozer expects to find it there
when packaging the Android APK.
"""

from ui.tbmapp import TbmApp

if __name__ == "__main__":
    TbmApp().run()

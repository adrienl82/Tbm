[app]
title = TBM Temps Reel
package.name = tbm
package.domain = org.tbmapp

source.dir = .
source.include_exts = py,kv,png,jpg,atlas

version = 0.1.0
requirements = python3,kivy,requests,certifi

orientation = portrait
fullscreen = 0

# Network access to reach bdx.mecatran.com
android.permissions = INTERNET

[buildozer]
log_level = 2
warn_on_root = 1

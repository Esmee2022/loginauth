Set WshShell = CreateObject("WScript.Shell")
DesktopPath = WshShell.SpecialFolders("Desktop")
ShortcutPath = DesktopPath & "\Start Server.lnk"
Set shortcut = WshShell.CreateShortcut(ShortcutPath)
shortcut.TargetPath = "C:\\Users\\LATITUDE\\Documents\\Login & Sign Up Form\\start.bat"
shortcut.WorkingDirectory = "C:\\Users\\LATITUDE\\Documents\\Login & Sign Up Form"
shortcut.IconLocation = "C:\\Users\\LATITUDE\\.gemini\\antigravity\\brain\\7ac0e806-33f6-485c-954b-af5756e6ccee\\server_icon_1791747061186.jpg,0"
shortcut.Save

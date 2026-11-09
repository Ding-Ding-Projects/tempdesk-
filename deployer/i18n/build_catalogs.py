"""Builds deployer/i18n/en.json and zh-HK.json from one table so both catalogs always have the
same keys. Each entry is (key, English, Traditional Chinese (Hong Kong)). A value may be a dict
{"0": serious, "1": light, "2": playful, "3": silly} for copy whose tone follows the funny
level; errors, warnings, security and confirmation text (err., warn., sec., confirm., danger.,
update.) always use level 0. Run: python deployer/i18n/build_catalogs.py
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent

E = []  # (key, en, zh)


def s(key, en, zh):
    E.append((key, en, zh))


def tone(key, en_levels, zh_levels):
    E.append((key, {str(i): v for i, v in enumerate(en_levels)}, {str(i): v for i, v in enumerate(zh_levels)}))


# ---- shell and navigation ---------------------------------------------------------------------
for k, en, zh, short_en, short_zh in [
    ('deploy', 'Deploy', '部署', 'Deploy', '部署'), ('answers', 'Answer File Studio', '應答檔案工作室', 'Answer files', '應答檔'),
    ('deployments', 'Deployments', '部署清單', 'Deployments', '清單'), ('portals', 'Portals', '入口網站', 'Portals', '入口'),
    ('base64', 'Tools: Base64', '工具：Base64', 'Base64', 'Base64'), ('history', 'History', '記錄', 'History', '記錄'),
    ('settings', 'Settings', '設定', 'Settings', '設定'), ('help', 'Help', '說明', 'Help', '說明')]:
    s('nav.' + k, en, zh)
    s('nav.' + k + '.short', short_en, short_zh)
s('nav.base64.kicker', 'Tools', '工具')
s('win.min', 'Minimize', '最小化'); s('win.max', 'Maximize or restore', '最大化或還原'); s('win.close', 'Close', '關閉')
s('common.cancel', 'Cancel', '取消'); s('common.close', 'Close', '關閉'); s('common.ok', 'OK', '確定'); s('common.copy', 'Copy', '複製')
s('common.copied', 'Copied to the clipboard.', '已複製到剪貼簿。'); s('common.dismiss', 'Dismiss', '關閉通知')
s('common.info', 'More information', '更多資料'); s('common.infoAbout', 'About {0}', '關於{0}')
s('ctx.open', 'Open', '開啟'); s('ctx.palette', 'Command palette', '指令面板')
s('err.page', 'This page could not be shown.', '無法顯示此頁面。')
s('about.provenance', 'Version {0}, commit {1}, built {2} UTC', '版本 {0}，提交 {1}，建置於 {2} UTC')

# ---- palette, search, notifications ----------------------------------------------------------
s('palette.open', 'Command palette', '指令面板'); s('palette.short', 'Search', '搜尋'); s('palette.label', 'Search pages, settings and actions', '搜尋頁面、設定及動作')
s('palette.placeholder', 'Type to search everything', '輸入以搜尋全部'); s('palette.results', 'Results', '結果'); s('palette.none', 'Nothing matches.', '沒有相符項目。')
s('palette.help', 'Enter runs, arrows move, switches toggle in place, Esc closes.', 'Enter 執行，方向鍵移動，開關可直接切換，Esc 關閉。')
s('palette.pages', 'Page', '頁面'); s('palette.tabs', 'Open tab', '已開啟分頁'); s('palette.actions', 'Action', '動作'); s('palette.settings', 'Setting', '設定'); s('palette.onPage', 'On this page', '此頁面')
s('search.placeholder', 'Search', '搜尋'); s('search.label', 'Search', '搜尋'); s('search.regexToggle', 'Regular expression', '正規表示式'); s('search.tokens', 'Regular expression helper', '正規表示式助手')
s('search.count', '{0} matches in {1} items', '{1} 個項目中有 {0} 個相符'); s('search.invalid', 'Not a valid pattern: {0}', '無效的模式：{0}'); s('search.matchesEmpty', 'This pattern also matches empty text.', '此模式亦會配對空白文字。')
for k, en, zh in [('any', 'Any character', '任何字元'), ('digit', 'A digit', '數字'), ('word', 'A letter, digit or underscore', '字母、數字或底線'), ('space', 'Whitespace', '空白'), ('start', 'Start of text', '文字開頭'), ('end', 'End of text', '文字結尾'),
                  ('zeroOrMore', 'Zero or more of the previous', '前一項零次或多次'), ('oneOrMore', 'One or more of the previous', '前一項一次或多次'), ('optional', 'Optional previous item', '前一項可有可無'), ('range', 'Between 2 and 4 times', '2 至 4 次'),
                  ('set', 'One of a, b or c', 'a、b 或 c 其中之一'), ('notSet', 'Anything except a, b or c', 'a、b、c 以外'), ('either', 'a or b', 'a 或 b'), ('boundary', 'Word boundary', '字詞邊界'), ('group', 'Group without capture', '不擷取的群組'), ('literalDot', 'A literal dot', '句點本身')]:
    s('rx.' + k, en, zh)
s('notif.title', 'Notifications', '通知'); s('notif.open', 'Notifications, {0} unread', '通知，{0} 則未讀'); s('notif.clear', 'Clear all', '全部清除')
s('notif.search', 'Search notifications', '搜尋通知'); s('notif.empty', 'No notifications yet', '暫時沒有通知'); s('notif.emptyHelp', 'Messages from deployments, imports and updates appear here.', '部署、匯入及更新的訊息會顯示在這裏。')
for k, en, zh in [('info', 'Information', '資訊'), ('success', 'Success', '成功'), ('error', 'Error', '錯誤')]:
    s('notif.kind.' + k, en, zh)

# ---- confirmations and warnings --------------------------------------------------------------
s('confirm.type', 'Type {0} to continue', '輸入 {0} 以繼續'); s('confirm.typeHelp', 'This makes sure the right thing is about to change.', '確保即將變更的是正確的項目。')
s('confirm.hold', 'Hold to confirm', '按住以確認'); s('confirm.holdHelp', 'Then press and hold the button for 1.5 seconds (or hold Space).', '然後按住按鈕 1.5 秒（或按住空白鍵）。'); s('confirm.holding', 'Keep holding...', '請繼續按住……')
s('warn.wipe', 'Installing from this media ERASES DISK 0 COMPLETELY. Every partition and file on it is deleted.', '使用此媒體安裝會完全清除磁碟 0。磁碟上所有分割區和檔案都會被刪除。')
s('warn.wipeHelp', 'Boot the target computer only. Disconnect other disks you want to keep, and never leave this media in a computer that should not be reinstalled.', '只在目標電腦上開機。請移除想保留的其他磁碟，亦不要把此媒體留在不應重裝的電腦上。')
s('warn.wipeTitle', 'Disk 0 will be erased', '磁碟 0 將被清除'); s('warn.wipeConfirm', 'Build media that erases disk 0 of the computer that becomes {0}?', '建立會清除將成為 {0} 的電腦的磁碟 0 的媒體？')
s('warn.wipeHold', 'Hold to build wiping media', '按住以建立會清除磁碟的媒體')
s('warn.mediaSecrets', 'The media holds passwords. Detach or erase it after the install.', '媒體內含密碼。安裝後請卸下或清除。')
s('warn.mediaSecretsHelp', 'The DSRM password is in plain text in TempDesk\\firstboot.json (unattended setup needs it), and the Administrator password is in autounattend.xml in Windows unattend encoding, which is base64 and not encryption. The server removes the passwords from its own copy when setup finishes.', 'DSRM 密碼以純文字存於 TempDesk\\firstboot.json（無人值守安裝需要），Administrator 密碼以 Windows 無人值守編碼存於 autounattend.xml，該編碼只是 base64，並非加密。安裝完成後，伺服器會從自己的副本中刪除密碼。')

# ---- deploy page ---------------------------------------------------------------------------
tone('deploy.title', ['Deploy TempDesk', 'Deploy TempDesk', 'Let us build a domain', 'Domain, assemble!'], ['部署 TempDesk', '部署 TempDesk', '一齊起個網域', '網域，集合！'])
s('deploy.kicker', 'Set up', '設定'); s('deploy.lead', 'Build unattended install media for Windows Server 2025 Core and watch it finish by itself, or deploy TempDesk Lite to a Linux host over SSH.', '為 Windows Server 2025 Core 建立無人值守安裝媒體並看着它自行完成，或經 SSH 把 TempDesk Lite 部署到 Linux 主機。')
s('deploy.kind', 'Deployment type', '部署類型'); s('deploy.kind.server', 'Windows Server Core', 'Windows Server Core'); s('deploy.kind.lite', 'TempDesk Lite (SSH)', 'TempDesk Lite（SSH）')
s('dep.name', 'Deployment name', '部署名稱'); s('dep.nameHelp', 'A local name for this deployment (letters, numbers, dot, dash, underscore, space).', '此部署的本機名稱（字母、數字、句點、連字號、底線、空格）。')
s('dep.invalid', 'Some settings are not valid: {0}', '部分設定無效：{0}')
for k, en, zh in [('computerName', 'Computer name', '電腦名稱'), ('domainName', 'Domain name (DNS)', '網域名稱（DNS）'), ('netbiosName', 'NetBIOS name', 'NetBIOS 名稱'), ('ipAddress', 'Static IPv4 address', '固定 IPv4 位址'),
                  ('prefixLength', 'Prefix length', '首碼長度'), ('gateway', 'Default gateway', '預設閘道'), ('dnsServers', 'DNS servers', 'DNS 伺服器'), ('imageIndex', 'Edition (image index)', '版本（映像索引）'), ('firmware', 'Firmware and disk layout', '韌體及磁碟配置'),
                  ('timeZone', 'Time zone', '時區'), ('locale', 'Language and region', '語言及地區'), ('productKey', 'Product key', '產品金鑰'), ('portalsMode', 'Portals', '入口網站'), ('adminPassword', 'Administrator password', 'Administrator 密碼'), ('dsrmPassword', 'Directory Services Restore Mode password', '目錄服務還原模式密碼')]:
    s('f.' + k, en, zh)
s('f.productKeyHelp', 'Leave empty for evaluation media or a key that is entered later.', '如使用評估版媒體或稍後才輸入金鑰，請留空。')
s('f.dsrmHelp', 'Needed to restore Active Directory. Stored on the media in plain text until setup finishes.', '還原 Active Directory 時需要。安裝完成前以純文字存於媒體。')
s('opt.uefi', 'UEFI (GPT: EFI 300 MB, MSR 16 MB, Windows)', 'UEFI（GPT：EFI 300 MB、MSR 16 MB、Windows）'); s('opt.bios', 'Legacy BIOS (MBR: System 500 MB, Windows)', '傳統 BIOS（MBR：系統 500 MB、Windows）')
s('opt.portals.none', 'None on the server (run them with Docker)', '伺服器上不安裝（以 Docker 執行）'); s('opt.portals.native', 'Native on the server (no Docker)', '在伺服器上原生安裝（不用 Docker）')
s('pw.show', 'Show', '顯示'); s('pw.generate', 'Generate', '產生'); s('pw.generated', 'A strong password was generated. Store it in your password manager.', '已產生強密碼。請把它存入密碼管理工具。')
s('pw.notStored', 'Kept in memory for this session only. Never saved by the desktop app.', '只在本次工作階段的記憶體中保留，桌面應用程式永不儲存。')
s('pw.policy', 'does not meet the policy (12+ characters, upper and lower case, digit, symbol)', '不符合政策（12 個字元以上，包含大小寫字母、數字及符號）')
for k, en, zh in [('empty', 'Empty', '空白'), ('veryWeak', 'Very weak', '非常弱'), ('weak', 'Weak', '弱'), ('fair', 'Fair', '一般'), ('strong', 'Strong', '強')]:
    s('pw.' + k, en, zh)
s('media.title', 'Step 1: Install media', '第 1 步：安裝媒體'); s('media.kicker', 'Unattended install', '無人值守安裝')
s('media.lead', 'Creates autounattend.xml and the TempDesk folder. Windows installs, becomes the first domain controller and finishes TempDesk by itself.', '建立 autounattend.xml 及 TempDesk 資料夾。Windows 會自行安裝、成為首個網域控制站並完成 TempDesk 設定。')
s('media.runTitle', 'Build the media', '建立媒體'); s('media.build', 'Build media (folder, zip kit and ISO)', '建立媒體（資料夾、zip 套件及 ISO）')
s('media.invalid', 'Fix these fields first: {0}', '請先修正以下欄位：{0}'); s('media.done', 'Media ready in {0}', '媒體已在 {0} 準備好')
s('media.openFolder', 'Show folder', '顯示資料夾'); s('media.zipKit', 'Show answer file kit (.zip)', '顯示應答檔套件（.zip）'); s('media.iso', 'Show ISO', '顯示 ISO')
s('media.howTo', 'Virtual machines: attach TempDesk-answer.iso as a second CD next to the Windows ISO. Bare metal: copy the folder contents (autounattend.xml and TempDesk) to the root of the Windows installer USB stick.', '虛擬機：把 TempDesk-answer.iso 作為第二張光碟連同 Windows ISO 掛載。實體機：把資料夾內容（autounattend.xml 及 TempDesk）複製到 Windows 安裝 USB 手指的根目錄。')
s('vm.title', 'Step 1b: VMware virtual machine (optional)', '第 1b 步：VMware 虛擬機（可選）'); s('vm.kicker', 'VMware Workstation', 'VMware Workstation')
s('vm.lead', 'Let TempDesk create a VMware Workstation virtual machine on this PC, attach the Windows ISO and the answer ISO, start it and boot the installer. Windows then installs with no clicks.', '讓 TempDesk 在這部電腦建立 VMware Workstation 虛擬機，掛上 Windows ISO 及應答 ISO，啟動並由安裝程式開機。之後 Windows 會全自動安裝，毋須點按。')
s('vm.runTitle', 'Create and start the virtual machine', '建立並啟動虛擬機'); s('vm.create', 'Create the virtual machine and start the install', '建立虛擬機並開始安裝')
s('vm.iso', 'Windows Server ISO file', 'Windows Server ISO 檔案'); s('vm.isoHelp', 'The full path of the Windows Server 2025 ISO on this PC.', '這部電腦上 Windows Server 2025 ISO 的完整路徑。'); s('vm.browse', 'Browse', '瀏覽')
s('vm.name', 'Virtual machine name', '虛擬機名稱'); s('vm.nameHelp', 'Leave empty to use TempDesk and the computer name.', '留空會使用「TempDesk」加電腦名稱。')
s('vm.folder', 'Folder for virtual machines', '虛擬機資料夾'); s('vm.folderHelp', 'Leave empty to use Virtual Machines in your Documents folder.', '留空會使用「文件」內的 Virtual Machines 資料夾。')
s('vm.cpus', 'Processors', '處理器數目'); s('vm.memory', 'Memory (MB)', '記憶體（MB）'); s('vm.disk', 'Disk size (GB)', '磁碟大小（GB）'); s('vm.network', 'Network', '網絡')
s('opt.vmnet.bridged', 'Bridged: on your LAN, matching the answer file', '橋接：接到你的區域網絡，配合應答檔'); s('opt.vmnet.nat', 'NAT: the VMware private network', 'NAT：VMware 私人網絡'); s('opt.vmnet.hostonly', 'Host-only: this PC only', '僅主機：只限這部電腦')
s('vm.show', 'Show the VMware window', '顯示 VMware 視窗'); s('vm.needIso', 'Choose the Windows Server ISO file first.', '請先選擇 Windows Server ISO 檔案。')
s('vm.drop', 'Drop the Windows Server ISO here, or click to choose it', '把 Windows Server ISO 拖放到這裡，或點按選擇'); s('vm.dropHelp', 'The file stays where it is: only its location is saved.', '檔案會留在原位，只會記住它的位置。')
s('vm.notIso', 'That is not an .iso file.', '這不是 .iso 檔案。'); s('vm.isoSet', 'Using {0}', '已選用 {0}')
s('vmm.title', 'Your TempDesk virtual machines', '你的 TempDesk 虛擬機'); s('vmm.lead', 'VMware Workstation machines created by TempDesk on this PC. Machines made any other way are not listed and are never changed.', '這部電腦上由 TempDesk 建立的 VMware Workstation 虛擬機。以其他方式建立的虛擬機不會列出，亦不會被改動。')
s('vmm.none', 'No TempDesk virtual machines yet. Create one in step 1b.', '暫時未有 TempDesk 虛擬機。可在第 1b 步建立。'); s('vmm.noVmware', 'VMware Workstation was not found on this PC.', '這部電腦找不到 VMware Workstation。')
s('vmm.refresh', 'Refresh', '重新整理'); s('vmm.running', 'Running', '執行中'); s('vmm.stopped', 'Stopped', '已停止')
s('vmm.start', 'Start', '啟動'); s('vmm.stop', 'Power off', '關機'); s('vmm.open', 'Open in VMware', '在 VMware 開啟'); s('vmm.screen', 'Show the screen', '顯示畫面'); s('vmm.delete', 'Delete', '刪除')
s('vmm.detail', '{0} processors, {1} MB, {2}, {3}', '{0} 個處理器、{1} MB、{2}、{3}'); s('vmm.screenOf', 'Screen of {0}', '{0} 的畫面')
s('vmm.started', 'Started {0}.', '已啟動 {0}。'); s('vmm.stoppedToast', 'Powered off {0}.', '已關閉 {0}。'); s('vmm.deleted', 'Deleted {0}.', '已刪除 {0}。'); s('vmm.failed', 'That did not work: {0}', '操作失敗：{0}')
s('vmm.stopTitle', 'Power off {0}?', '要關閉 {0} 嗎？'); s('vmm.stopText', 'This is like pulling the plug: anything Windows has not saved is lost.', '這等同直接拔掉電源：Windows 未儲存的內容會遺失。')
s('vmm.noScreen', 'The screen is not available (the machine is off, or this VMware version cannot capture it).', '無法取得畫面（虛擬機已關機，或這個 VMware 版本不支援擷取）。')
s('danger.vmDelete', 'This deletes the virtual machine and its disk. It cannot be undone.', '這會刪除虛擬機及其磁碟，無法復原。'); s('confirm.vmDelete', 'Delete the virtual machine {0} and everything in its folder?', '要刪除虛擬機 {0} 以及其資料夾內的所有內容嗎？'); s('confirm.vmDeleteHold', 'Hold to delete the virtual machine', '按住以刪除虛擬機')
s('err.vmRunning', 'Power the virtual machine off before deleting it.', '請先關閉虛擬機，然後才刪除。'); s('err.vmNotManaged', 'That is not a virtual machine TempDesk created.', '這不是由 TempDesk 建立的虛擬機。')
s('vm.done', 'Virtual machine {0} is installing Windows. Watch the install below.', '虛擬機 {0} 正在安裝 Windows。可在下方監察安裝。')
s('vm.safe', 'Only the new virtual machine and its empty disk are used. No existing virtual machine is changed.', '只會使用新建的虛擬機及其空白磁碟，不會改動任何現有虛擬機。')
s('server.kicker', 'Step 2', '第 2 步'); s('server.monTitle', 'Setting up {0}', '正在設定 {0}'); s('server.advTitle', 'Deploying to {0}', '正在部署到 {0}')
s('server.watch', 'Watch setup', '監察安裝'); s('server.deploy', 'Deploy to this server', '部署到此伺服器')
s('server.advanced', 'Advanced: deploy to an existing server', '進階：部署到現有伺服器')
s('server.monHelp', 'After the computer boots from the media, the desktop app reads the setup progress over WinRM (HTTP 5985) and collects the agent keys when it is ready. Windows asks for approval once to trust the server.', '電腦從媒體開機後，桌面應用程式會經 WinRM（HTTP 5985）讀取安裝進度，並在完成後取得代理程式金鑰。Windows 會詢問一次是否信任該伺服器。')
s('server.advHelp', 'For a Windows Server that is already installed with remoting on: copies the files, creates the forest, waits across the restart, configures TempDesk and installs the agent.', '適用於已安裝並啟用遠端管理的 Windows Server：複製檔案、建立樹系、等待重新開機、設定 TempDesk 並安裝代理程式。')
s('server.needPassword', 'Enter the Administrator password in step 1 first.', '請先在第 1 步輸入 Administrator 密碼。')
tone('server.ready', ['The server is ready.', 'The server is ready.', 'Your domain is open for business.', 'The domain controller has entered the chat.'], ['伺服器已準備就緒。', '伺服器已準備就緒。', '你的網域開張了。', '網域控制站已上線。'])
s('trust.asking', 'Asking Windows for approval to add the server to WinRM TrustedHosts...', '正在要求 Windows 批准把伺服器加入 WinRM TrustedHosts……')
s('trust.ok', 'The server is trusted for remoting.', '已信任該伺服器作遠端管理。'); s('trust.cancelled', 'The Windows approval prompt was cancelled.', 'Windows 批准提示已取消。')
s('trust.incomplete', 'Incomplete: the server was not added to TrustedHosts because the approval was cancelled. Start again to retry.', '未完成：由於批准已取消，伺服器未加入 TrustedHosts。請重新開始以再試。')
s('trust.failed', 'The elevated helper could not change TrustedHosts.', '提升權限的輔助程式無法變更 TrustedHosts。')
s('lite.title', 'TempDesk Lite over SSH', '經 SSH 部署 TempDesk Lite'); s('lite.kicker', 'Linux host', 'Linux 主機')
s('lite.lead', 'A Samba domain controller in a Docker container on a Linux host, with the same TempDesk API. Needs Docker Engine and the compose plugin on the host.', '在 Linux 主機的 Docker 容器中執行 Samba 網域控制站，提供相同的 TempDesk API。主機需要 Docker Engine 及 compose 外掛程式。')
s('ssh.title', 'SSH connection', 'SSH 連線'); s('ssh.user', 'User', '使用者'); s('ssh.host', 'Host', '主機'); s('ssh.port', 'Port', '連接埠'); s('ssh.dir', 'Remote folder', '遠端資料夾')
s('ssh.acceptNew', 'Accept the host key on first connection', '首次連線時接受主機金鑰')
s('ssh.genKey', 'Create an SSH key', '建立 SSH 金鑰'); s('ssh.console', 'First connection in a console', '在主控台進行首次連線')
s('ssh.pasteKey', 'Add this public key to ~/.ssh/authorized_keys on the host:', '請把此公開金鑰加入主機的 ~/.ssh/authorized_keys：')
s('ssh.keyFailed', 'Could not create the key: {0}', '無法建立金鑰：{0}'); s('ssh.consoleOpened', 'A console window opened. Confirm the host key and sign in there.', '已開啟主控台視窗。請在該處確認主機金鑰並登入。'); s('ssh.consoleFailed', 'The console could not be opened.', '無法開啟主控台。')
s('lite.domain', 'Domain and network', '網域及網絡'); s('lite.realm', 'Realm (DNS domain)', '領域（DNS 網域）'); s('lite.netbios', 'NetBIOS name', 'NetBIOS 名稱'); s('lite.dcIp', 'Domain controller IP', '網域控制站 IP')
s('lite.parent', 'Host network interface', '主機網絡介面'); s('lite.subnet', 'LAN subnet', '區域網絡子網'); s('lite.gateway', 'LAN gateway', '區域網絡閘道'); s('lite.forwarder', 'DNS forwarder', 'DNS 轉寄站')
s('lite.adminPassword', 'Domain Administrator password', '網域 Administrator 密碼'); s('lite.adminPasswordHelp', 'Sent over SSH standard input into a secret file readable only by the owner (chmod 600). Never on a command line.', '經 SSH 標準輸入寫入只有擁有者可讀的機密檔案（chmod 600），永不出現在指令列。')
s('lite.runTitle', 'Deploying to {0}', '正在部署到 {0}'); s('lite.deploy', 'Deploy TempDesk Lite', '部署 TempDesk Lite'); s('lite.weak', 'Use a strong Administrator password.', '請使用強的 Administrator 密碼。')

# ---- run panel ------------------------------------------------------------------------------
s('run.steps', 'Steps', '步驟'); s('run.progress', 'Progress', '進度'); s('run.log', 'Live log', '即時記錄')
s('run.start', 'Start', '開始'); s('run.resume', 'Resume from the failed step', '由失敗的步驟繼續'); s('run.restart', 'Start over', '重新開始'); s('run.cancel', 'Cancel', '取消')
s('run.exportLog', 'Export log', '匯出記錄'); s('run.copyStep', 'Copy step status', '複製步驟狀態'); s('run.running', 'Running...', '執行中……')
s('run.elapsed', 'Running for {0}', '已執行 {0}'); s('run.doneIn', 'Finished in {0}', '於 {0} 內完成'); s('run.secs', '{0} s', '{0} 秒'); s('run.mins', '{0} min', '{0} 分鐘')
s('run.started', 'Started: {0}', '已開始：{0}'); s('run.cancelling', 'Cancelling...', '正在取消……'); s('run.cancelled', 'Cancelled. Nothing is lost: resume when ready.', '已取消。沒有任何損失：準備好後可繼續。')
s('run.failed', 'Stopped at a failed step. Fix the cause, then resume.', '在失敗的步驟停止。請修正原因後繼續。'); s('run.failedAt', 'Failed at: {0}', '失敗於：{0}')
s('run.failedToast', '{0} stopped with an error. See the recovery hint.', '{0} 因錯誤停止。請參閱復原提示。')
tone('run.success', ['{0}: done.', '{0}: done.', '{0}: done and dusted.', '{0}: absolutely nailed it.'], ['{0}：完成。', '{0}：完成。', '{0}：搞掂晒。', '{0}：完美過關。'])
for k, en, zh in [('pending', 'pending', '等待中'), ('running', 'in progress', '進行中'), ('done', 'done', '完成'), ('failed', 'failed', '失敗'), ('skipped', 'already done', '早已完成')]:
    s('state.' + k, en, zh)
STEPS = [('folder', 'Write autounattend.xml and the TempDesk folder', '寫入 autounattend.xml 及 TempDesk 資料夾', 'Check the payload folder exists and the output folder is writable.', '請確認載荷資料夾存在，而輸出資料夾可寫入。'),
         ('zip', 'Create the answer file kit (.zip)', '建立應答檔套件（.zip）', 'Check free disk space.', '請檢查可用磁碟空間。'),
         ('iso', 'Build the ISO', '建立 ISO', 'IMAPI2FS is part of Windows. If it fails, use the zip kit on a USB stick.', 'IMAPI2FS 是 Windows 內置元件。如失敗，請把 zip 套件放到 USB 手指。'),
         ('trust', 'Trust the server for remoting', '信任伺服器作遠端管理', 'Approve the Windows prompt. To do it by hand: Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Concatenate -Value <ip> in an elevated PowerShell.', '請批准 Windows 提示。手動方法：在提升權限的 PowerShell 執行 Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Concatenate -Value <ip>。'),
         ('reach', 'Wait for the server to answer', '等待伺服器回應', 'Check the server is on, has the IP from the answer file and that TCP 5985 is reachable from this PC.', '請確認伺服器已開機、使用應答檔中的 IP，而此電腦可連到 TCP 5985。'),
         ('stage-copy', 'Windows installed, files copied', 'Windows 已安裝，檔案已複製', '', ''), ('stage-network', 'Network and remoting', '網絡及遠端管理', '', ''),
         ('stage-forest', 'Forest created', '已建立樹系', 'Read C:\\ProgramData\\TempDesk\\logs\\install-forest-*.log on the server.', '請查看伺服器上的 C:\\ProgramData\\TempDesk\\logs\\install-forest-*.log。'),
         ('stage-adws', 'Active Directory online', 'Active Directory 已上線', 'Active Directory Web Services can take several minutes after the first restart.', '首次重新開機後，Active Directory Web Services 可能需要數分鐘。'),
         ('stage-domain', 'TempDesk policies and groups', 'TempDesk 原則及群組', 'Read C:\\ProgramData\\TempDesk\\logs\\initialize-*.log on the server.', '請查看伺服器上的 C:\\ProgramData\\TempDesk\\logs\\initialize-*.log。'),
         ('stage-agent', 'Agent service', '代理程式服務', 'Run C:\\TempDesk\\agent\\install.ps1 on the server to see the full error.', '在伺服器執行 C:\\TempDesk\\agent\\install.ps1 以查看完整錯誤。'),
         ('stage-portals', 'Portals', '入口網站', '', ''), ('stage-ready', 'Ready', '已就緒', '', ''),
         ('keys', 'Fetch agent keys', '取得代理程式金鑰', 'Make sure C:\\ProgramData\\TempDesk\\agent.json exists on the server.', '請確認伺服器上存在 C:\\ProgramData\\TempDesk\\agent.json。'),
         ('envs', 'Write portal settings', '寫入入口網站設定', '', ''),
         ('vmware', 'Find VMware Workstation', '尋找 VMware Workstation', 'Install VMware Workstation Pro on this PC, then try again.', '請先在這部電腦安裝 VMware Workstation Pro，然後再試。'),
         ('vmmedia', 'Check the Windows ISO and the answer ISO', '檢查 Windows ISO 及應答 ISO', 'Choose the Windows Server ISO file, and build the install media first so the answer ISO exists.', '請選擇 Windows Server ISO 檔案，並先建立安裝媒體，才會有應答 ISO。'),
         ('vmcreate', 'Create the virtual machine', '建立虛擬機', 'Choose another virtual machine name, or delete the old virtual machine in VMware first.', '請改用另一個虛擬機名稱，或先在 VMware 刪除舊的虛擬機。'),
         ('vmstart', 'Start it and boot the Windows installer', '啟動並由 Windows 安裝程式開機', 'Open the virtual machine in VMware Workstation, power it on and press a key when it says "Press any key to boot from CD or DVD".', '請在 VMware Workstation 開啟虛擬機並開機，見到「Press any key to boot from CD or DVD」時按任何鍵。'),
         ('copy', 'Copy TempDesk files', '複製 TempDesk 檔案', 'Check free space on C: and that the account is a local administrator.', '請檢查 C: 的可用空間，以及帳戶是本機系統管理員。'),
         ('forest', 'Create the forest', '建立樹系', 'Read C:\\ProgramData\\TempDesk\\logs\\install-forest-*.log on the server.', '請查看伺服器上的 C:\\ProgramData\\TempDesk\\logs\\install-forest-*.log。'),
         ('adws', 'Wait for Active Directory after the restart', '重新開機後等待 Active Directory', 'Active Directory Web Services can take several minutes after the first restart.', '首次重新開機後，Active Directory Web Services 可能需要數分鐘。'),
         ('domain', 'Create TempDesk OUs, groups and policies', '建立 TempDesk OU、群組及原則', 'Read C:\\ProgramData\\TempDesk\\logs\\initialize-*.log on the server.', '請查看伺服器上的 C:\\ProgramData\\TempDesk\\logs\\initialize-*.log。'),
         ('agent', 'Install the TempDesk Agent', '安裝 TempDesk 代理程式', 'Run C:\\TempDesk\\agent\\install.ps1 on the server to see the full error.', '在伺服器執行 C:\\TempDesk\\agent\\install.ps1 以查看完整錯誤。'),
         ('connect', 'Connect over SSH', '經 SSH 連線', 'Add the public key to ~/.ssh/authorized_keys on the host, or use the first connection in a console to confirm the host key.', '請把公開金鑰加入主機的 ~/.ssh/authorized_keys，或在主控台進行首次連線以確認主機金鑰。'),
         ('docker', 'Check Docker and Docker Compose', '檢查 Docker 及 Docker Compose', 'Install Docker Engine and the compose plugin, and add this user to the docker group.', '請安裝 Docker Engine 及 compose 外掛程式，並把此使用者加入 docker 群組。'),
         ('upload', 'Upload TempDesk files', '上載 TempDesk 檔案', 'Check free disk space and write access to the remote folder.', '請檢查可用磁碟空間及遠端資料夾的寫入權限。'),
         ('config', 'Write domain settings and the password secret', '寫入網域設定及密碼機密', '', ''),
         ('up', 'Build and start the domain controller', '建置並啟動網域控制站', 'Run "docker compose logs dc" in the samba folder on the host.', '請在主機的 samba 資料夾執行「docker compose logs dc」。'),
         ('health', 'Wait until the domain controller is healthy', '等待網域控制站狀態正常', 'The first start provisions the domain and can take several minutes. Check "docker compose ps" on the host.', '首次啟動會佈建網域，可能需要數分鐘。請在主機查看「docker compose ps」。'),
         ('portals', 'Start the portals', '啟動入口網站', 'Make sure Docker is running on the target, then try again.', '請確認目標上的 Docker 正在執行，然後再試。'),
         ('uninstall', 'Remove the TempDesk Agent service', '移除 TempDesk 代理程式服務', '', ''), ('monitor', 'Setup on the server', '伺服器上的安裝', 'See C:\\ProgramData\\TempDesk\\logs on the server. Fix the cause and restart the server: setup continues where it stopped.', '請查看伺服器上的 C:\\ProgramData\\TempDesk\\logs。修正原因後重新開機：安裝會由停止處繼續。')]
for k, en, zh, hen, hzh in STEPS:
    s('step.' + k, en, zh)
    s('hint.' + k, hen or 'Read the live log for the details, fix the cause, then resume.', hzh or '請查看即時記錄的詳情，修正原因後繼續。')
s('hint.generic', 'Read the live log for the details, fix the cause, then resume.', '請查看即時記錄的詳情，修正原因後繼續。')
s('export.title', 'Export', '匯出'); s('export.saved', 'Saved to {0}', '已儲存到 {0}')
s('export.logHelp', 'Choose a format for the log.', '請選擇記錄的格式。'); s('export.depHelp', 'Deployment configs are exported without passwords or keys.', '匯出的部署設定不包含密碼或金鑰。'); s('export.invHelp', 'The inventory lists the deployment, the agent address and the generated files, without secrets.', '清單列出部署、代理程式位址及產生的檔案，不含機密。')

# ---- deployments ------------------------------------------------------------------------------
s('deps.title', 'Deployments', '部署清單'); s('deps.lead', 'Saved on this PC without passwords. Agent keys stay in a folder only you can read.', '儲存在此電腦，不含密碼。代理程式金鑰存放在只有你可讀取的資料夾。')
s('deps.new', 'New deployment', '新增部署'); s('deps.export', 'Export', '匯出'); s('deps.import', 'Import', '匯入'); s('deps.search', 'Search deployments', '搜尋部署')
tone('deps.empty', ['No deployments yet', 'No deployments yet', 'Nothing deployed yet, all calm', 'Suspiciously quiet in here'], ['暫時沒有部署', '暫時沒有部署', '仲未部署，一切平靜', '靜得有啲可疑'])
s('deps.emptyHelp', 'Create one on the Deploy page. It appears here once its settings are saved.', '請在「部署」頁面建立。儲存設定後會在這裏出現。')
s('deps.item', 'Deployment {0}', '部署 {0}'); s('deps.kind.server', 'Windows Server Core', 'Windows Server Core'); s('deps.kind.lite', 'TempDesk Lite', 'TempDesk Lite')
s('deps.updated', 'updated {0}', '更新於 {0}'); s('deps.keys', 'Agent keys stored', '已儲存代理程式金鑰'); s('deps.noKeys', 'No agent keys yet', '仲未有代理程式金鑰')
s('deps.open', 'Open', '開啟'); s('deps.health', 'Health check', '健康檢查'); s('deps.folder', 'Open protected folder', '開啟受保護資料夾'); s('deps.exportOne', 'Export this deployment', '匯出此部署')
s('deps.duplicate', 'Duplicate', '複製一份'); s('deps.delete', 'Delete', '刪除'); s('deps.deleteTitle', 'Delete this deployment', '刪除此部署')
s('deps.deleteWarn', 'This removes the saved settings from this PC. The server and its data are not touched; the protected key folder stays until you delete it.', '這會從此電腦移除已儲存的設定。伺服器及其資料不受影響；受保護的金鑰資料夾會保留直至你刪除。')
s('deps.deleteHold', 'Hold to delete', '按住以刪除'); s('deps.deleted', 'Deleted {0}', '已刪除 {0}')
s('dep.missing', 'The deployment {0} no longer exists.', '部署 {0} 已不存在。'); s('dep.summary', 'Summary', '摘要'); s('dep.actions', 'Manage', '管理')
s('dep.rerun', 'Re-run steps', '重新執行步驟'); s('dep.updatePayload', 'Update payload on the server', '更新伺服器上的載荷'); s('dep.updateHelp', 'Advanced deploy is selected: completed steps are skipped and the files are copied again.', '已選取進階部署：已完成的步驟會略過，檔案會重新複製。')
s('dep.uninstall', 'Uninstall agent', '解除安裝代理程式'); s('dep.uninstallTitle', 'Uninstall the TempDesk Agent', '解除安裝 TempDesk 代理程式')
s('dep.uninstallWarn', 'The portals stop working until the agent is installed again. Keys and settings on the server are kept.', '在重新安裝代理程式前，入口網站將無法運作。伺服器上的金鑰及設定會保留。'); s('dep.uninstallHold', 'Hold to uninstall', '按住以解除安裝')
s('dep.inventory', 'Export inventory', '匯出清單'); s('dep.files', 'Generated files', '產生的檔案'); s('dep.noEnv', 'No portal settings yet. They are written when the deployment finishes.', '仲未有入口網站設定。部署完成後會寫入。')
s('dep.keysStored', 'Agent keys are stored in the protected folder (only your Windows account can read it).', '代理程式金鑰儲存在受保護資料夾（只有你的 Windows 帳戶可讀取）。'); s('dep.noKeysYet', 'Agent keys are collected at the end of the deployment.', '代理程式金鑰會在部署結束時取得。')
s('health.notChecked', 'Not checked yet.', '仲未檢查。'); s('health.checking', 'Checking...', '檢查中……')
s('health.ok', '{0}: agent {1} answers for {2} ({3}).', '{0}：代理程式 {1} 正在為 {2}（{3}）回應。'); s('health.fail', '{0}: the agent did not answer ({1}).', '{0}：代理程式沒有回應（{1}）。')
s('import.tooLarge', 'The file is too large.', '檔案太大。'); s('import.badJson', 'The file is not valid JSON. Nothing was imported.', '檔案不是有效的 JSON。沒有匯入任何內容。')
s('import.badEntry', 'Entry {0} is not valid ({1}). Nothing was imported.', '第 {0} 項無效（{1}）。沒有匯入任何內容。'); s('import.done', 'Imported {0} deployments.', '已匯入 {0} 個部署。')
s('import.settingsBad', 'The settings file is not valid ({0}). Nothing changed.', '設定檔無效（{0}）。沒有任何變更。'); s('import.settingsDone', 'Settings imported.', '已匯入設定。')

# ---- portals -------------------------------------------------------------------------------
s('portals.title', 'Portals', '入口網站'); s('portals.lead', 'Start the guest portal and the admin console with Docker, here or on the Lite host, and share the guest address.', '以 Docker 在此電腦或 Lite 主機啟動訪客入口網站及管理主控台，並分享訪客網址。')
s('portals.empty', 'No deployment has agent keys yet', '仲未有部署取得代理程式金鑰'); s('portals.emptyHelp', 'Finish a deployment first: the portals need the keys it collects.', '請先完成部署：入口網站需要部署取得的金鑰。')
s('portals.deployment', 'Deployment', '部署'); s('portals.where', 'Run the portals on', '入口網站執行位置'); s('portals.local', 'This PC (Docker Desktop)', '此電腦（Docker Desktop）'); s('portals.ssh', 'The Lite host over SSH', '經 SSH 的 Lite 主機')
s('portals.host', 'Address people use', '使用者用的位址'); s('portals.hostHelp', 'The name or IP address of the computer running the portals, as other PCs reach it.', '執行入口網站的電腦名稱或 IP 位址（以其他電腦連線的方式）。'); s('portals.hostPh', 'for example 192.168.10.20', '例如 192.168.10.20')
s('portals.needHost', 'Enter the address to see the links and the QR code.', '請輸入位址以查看連結及 QR 碼。'); s('portals.guest', 'Guest portal', '訪客入口網站'); s('portals.admin', 'Admin console', '管理主控台')
s('portals.openBrowser', 'Open', '開啟'); s('portals.openAdmin', 'Open admin console', '開啟管理主控台'); s('portals.openFailed', 'The link could not be opened.', '無法開啟連結。')
s('portals.qr', 'QR code for {0}', '{0} 的 QR 碼'); s('portals.qrHelp', 'Made on this PC. Print it next to the shared computers.', '在此電腦產生。可列印並放在共用電腦旁。')
s('portals.httpNote', 'Plain HTTP by default: keep the portals on a trusted network, or put a TLS reverse proxy in front.', '預設為純 HTTP：請把入口網站放在受信任的網絡，或在前面加上 TLS 反向代理。')
s('portals.nativeNote', 'This server hosts the portals natively (no Docker): guest on port 8081, admin on 8082.', '此伺服器原生提供入口網站（不用 Docker）：訪客在 8081 連接埠，管理在 8082。'); s('portals.start', 'Start portals for {0}', '為 {0} 啟動入口網站')

# ---- answer file studio -------------------------------------------------------------------
s('studio.title', 'Answer File Studio', '應答檔案工作室'); s('studio.desktopTools', 'Desktop tools', '桌面工具')
s('studio.open', 'Open file', '開啟檔案'); s('studio.recent', 'Recent files', '最近的檔案'); s('studio.save', 'Save', '儲存'); s('studio.saveAs', 'Save as', '另存新檔')
s('studio.file', 'File', '檔案'); s('studio.fileHelp', 'New, open, recent files, save and save as', '新增、開啟、最近的檔案、儲存及另存新檔')
s('studio.new', 'New blank answer file', '新增空白應答檔'); s('studio.discard', 'Discard the unsaved changes and start a blank answer file?', '捨棄未儲存的變更並開始新的空白應答檔？')
s('studio.blankReady', 'Blank answer file ready in Direct mode. Add components to any pass.', '空白應答檔已在直接模式準備好。可在任何階段加入元件。')
s('studio.iso', 'Build ISO', '建立 ISO'); s('studio.usb', 'Write to USB', '寫入 USB'); s('studio.branch', 'Variant (Git branch)', '變體（Git 分支）')
s('studio.newBranch', 'New variant...', '新增變體……'); s('studio.branchName', 'Branch name', '分支名稱'); s('studio.branchBad', 'Use letters, numbers, dot, dash, underscore or slash.', '請使用字母、數字、句點、連字號、底線或斜線。')
s('studio.branchHelp', 'Each preset variant can live on its own Git branch in the workspace.', '每個預設變體可以在工作區有自己的 Git 分支。'); s('studio.branchNoGit', 'Branches need Git for Windows.', '分支需要 Git for Windows。'); s('studio.onBranch', 'Now on {0}', '現在位於 {0}')
s('studio.untitled', 'Not saved to a file', '未儲存到檔案'); s('studio.unsaved', 'unsaved changes', '有未儲存的變更'); s('studio.tooLarge', 'The file is larger than 4 MiB.', '檔案大於 4 MiB。')
s('studio.importUnsupported', 'The studio could not import this file.', '工作室無法匯入此檔案。'); s('studio.opened', 'Opened {0}', '已開啟 {0}'); s('studio.notReady', 'The studio is still loading.', '工作室仍在載入。'); s('studio.saved', 'Saved {0}', '已儲存 {0}')
s('studio.noRecent', 'No recent files yet.', '暫時沒有最近的檔案。'); s('studio.recentSearch', 'Search recent files', '搜尋最近的檔案')
s('studio.isoConfirm', 'The ISO contains this answer file. If it wipes a disk, the computer that boots it is erased.', 'ISO 會包含此應答檔。如應答檔會清除磁碟，用它開機的電腦會被清除。')
s('studio.folderExists', 'The folder {0} is not empty.', '資料夾 {0} 不是空的。'); s('studio.building', 'Building the ISO...', '正在建立 ISO……'); s('studio.isoDone', 'ISO ready: {0}', 'ISO 已完成：{0}'); s('studio.isoFailed', 'The ISO could not be built.', '無法建立 ISO。')
s('studio.driverAdded', 'Added the driver path {0}', '已加入驅動程式路徑 {0}'); s('studio.driverExists', 'That driver path is already listed.', '該驅動程式路徑已在清單中。'); s('studio.driverUnsupported', 'Switch to the Custom template to add driver paths.', '請切換到「自訂」範本以加入驅動程式路徑。')
s('studio.changedTitle', 'File changed on disk', '磁碟上的檔案已變更'); s('studio.changed', '{0} was changed by another program. Reload it?', '{0} 已被其他程式變更。要重新載入嗎？'); s('studio.reload', 'Reload', '重新載入'); s('studio.removed', '{0} was deleted or moved.', '{0} 已被刪除或移動。')
s('usb.title', 'Write to a USB stick', '寫入 USB 手指'); s('usb.lead', 'Copies autounattend.xml and the TempDesk folder to the root of the drive, next to the Windows installer files. The drive is not formatted.', '把 autounattend.xml 及 TempDesk 資料夾複製到磁碟根目錄，與 Windows 安裝檔案並列。不會格式化磁碟。')
s('usb.drive', 'Removable drive', '卸除式磁碟'); s('usb.noLabel', 'no label', '沒有標籤'); s('usb.next', 'Next', '下一步'); s('usb.none', 'No removable drive was found.', '找不到卸除式磁碟。'); s('usb.unavailable', 'Removable drives can only be listed on Windows.', '只可在 Windows 列出卸除式磁碟。')
s('usb.confirm', 'Any computer that boots from {0}: with this answer file can have disk 0 erased.', '任何從 {0}: 以此應答檔開機的電腦，磁碟 0 都可能被清除。')
s('usb.replaceTitle', 'Replace the existing answer file', '取代現有的應答檔'); s('usb.replace', '{0}: already has an autounattend.xml. Replace it?', '{0}: 已有 autounattend.xml。要取代嗎？'); s('usb.replaceHold', 'Hold to replace', '按住以取代')
s('usb.done', 'Wrote {0} files to {1}', '已寫入 {0} 個檔案到 {1}'); s('usb.failed', 'Writing to the drive failed.', '寫入磁碟失敗。')

# ---- base64 -----------------------------------------------------------------------------------
s('b64.title', 'Base64 toolkit', 'Base64 工具'); s('b64.lead', 'Encode and decode text, data URLs and files of any size on this PC. Nothing leaves the computer.', '在此電腦為文字、data URL 及任何大小的檔案編碼及解碼。資料不會離開電腦。')
s('b64.text', 'Text', '文字'); s('b64.mode', 'Direction', '方向'); s('b64.encode', 'Encode', '編碼'); s('b64.decode', 'Decode', '解碼')
s('b64.variant', 'Variant', '變體'); s('b64.v.standard', 'Standard', '標準'); s('b64.v.url', 'URL-safe', 'URL 安全'); s('b64.v.mime', 'MIME (76 characters, CRLF)', 'MIME（76 個字元，CRLF）')
s('b64.lineLength', 'Line length (0 = none)', '每行長度（0 = 不分行）'); s('b64.encoding', 'Text encoding', '文字編碼'); s('b64.pad', 'Padding (=)', '補位（=）'); s('b64.strict', 'Strict decoding (exact error offsets)', '嚴格解碼（準確錯誤位置）')
s('b64.keep', 'Keep payloads in history', '在記錄中保留內容'); s('b64.input', 'Input', '輸入'); s('b64.output', 'Output', '輸出'); s('b64.preview', 'Safe preview', '安全預覽')
s('b64.paste', 'Paste', '貼上'); s('b64.copy', 'Copy output', '複製輸出'); s('b64.dataUrl', 'Copy as data: URL', '以 data: URL 複製'); s('b64.dataUrlCopied', 'data: URL copied.', '已複製 data: URL。')
s('b64.saveOut', 'Save output', '儲存輸出'); s('b64.json', 'Export JSON record', '匯出 JSON 記錄'); s('b64.swap', 'Swap', '對調')
s('b64.encLen', '{0} characters', '{0} 個字元'); s('b64.detected', 'Detected {0}, {1}', '偵測為 {0}，{1}'); s('b64.declared', 'the data: URL says {0}', 'data: URL 標示為 {0}')
s('b64.imageAlt', 'Decoded image ({0})', '已解碼圖片（{0}）'); s('b64.binaryOut', 'Binary data, {0}. Save it as a file.', '二進位資料，{0}。請另存為檔案。')
s('b64.err.char', 'Invalid character at offset {0} ({1}).', '位置 {0} 有無效字元（{1}）。'); s('b64.err.padding', 'Invalid padding at offset {0}.', '位置 {0} 的補位無效。')
s('b64.err.length', 'The text ends with a single extra character at offset {0}.', '文字在位置 {0} 結尾多出一個字元。'); s('b64.err.afterPad', 'Data after padding at offset {0}.', '位置 {0} 在補位之後仍有資料。')
s('b64.err.bits', 'Non-zero unused bits at offset {0} (strict mode).', '位置 {0} 有非零的未用位元（嚴格模式）。'); s('b64.err.latin1', 'Character at offset {0} cannot be written in Latin-1.', '位置 {0} 的字元無法以 Latin-1 表示。')
s('b64.err.utf16', 'An odd number of bytes cannot be UTF-16 text.', '單數位元組無法成為 UTF-16 文字。'); s('b64.err.notData', 'Not a data: URL.', '不是 data: URL。'); s('b64.err.noComma', 'A data: URL needs a comma before the data.', 'data: URL 在資料前需要逗號。')
s('b64.err.generic', 'Could not convert: {0}', '無法轉換：{0}'); s('b64.err.cancelled', 'Cancelled.', '已取消。'); s('b64.err.exists', 'The output file already exists.', '輸出檔案已存在。'); s('b64.err.error', 'The conversion failed.', '轉換失敗。')
s('b64.files', 'Files', '檔案'); s('b64.filesLead', 'Any size, constant memory. The result is verified with SHA-256 before it appears; the source is never overwritten.', '任何大小，記憶體用量固定。結果出現前會以 SHA-256 驗證；永不覆寫來源檔案。')
s('b64.noFile', 'No file chosen. Pick one or drop it on the window.', '未選擇檔案。請選擇或拖放到視窗。'); s('b64.fileInfo', '{0}, {1}, looks like {2}', '{0}，{1}，看似 {2}')
s('b64.pick', 'Choose file', '選擇檔案'); s('b64.outDir', 'Choose output folder', '選擇輸出資料夾'); s('b64.outNext', 'Output goes next to the source.', '輸出會放在來源旁。'); s('b64.outIn', 'Output goes to {0}', '輸出會放到 {0}')
s('b64.encodeFile', 'Encode file', '為檔案編碼'); s('b64.decodeFile', 'Decode file', '為檔案解碼'); s('b64.pause', 'Pause', '暫停'); s('b64.resume', 'Resume', '繼續'); s('b64.fileProgress', 'File progress', '檔案進度')
s('b64.working', 'Working...', '處理中……'); s('b64.progress', '{0} of {1}', '{0} / {1}'); s('b64.verifying', 'Verifying SHA-256...', '正在驗證 SHA-256……'); s('b64.paused', 'Paused.', '已暫停。')
s('b64.fileDone', 'Done: {0} (SHA-256 {1}...)', '完成：{0}（SHA-256 {1}……）'); s('b64.fileDoneToast', 'Verified and saved {0}', '已驗證並儲存 {0}'); s('b64.dropFailed', 'The dropped file could not be read.', '無法讀取拖放的檔案。')
s('b64.overwriteTitle', 'Replace an existing file', '取代現有檔案'); s('b64.overwriteWarn', '{0} already exists and will be replaced.', '{0} 已存在並將被取代。'); s('b64.overwriteHold', 'Hold to replace', '按住以取代')
s('b64.history', 'Conversion history', '轉換記錄'); s('b64.histSearch', 'Search conversions', '搜尋轉換'); s('b64.histEmpty', 'No conversions yet.', '暫時沒有轉換。')
s('b64.payloadKept', 'payload kept', '已保留內容'); s('b64.reuse', 'Use again', '再次使用'); s('b64.noPayload', 'The payload was not kept for this entry.', '此項目沒有保留內容。'); s('b64.bulk', 'Export kept payloads (.zip)', '匯出已保留的內容（.zip）'); s('b64.bulkNone', 'No entries keep their payload.', '沒有項目保留內容。')
for k, en, zh in [('encodeText', 'Encode {0} characters of text', '為 {0} 個字元的文字編碼'), ('decodeText', 'Decode {0} characters of Base64', '為 {0} 個字元的 Base64 解碼'), ('encodeFile', 'Encode a file', '為檔案編碼'), ('decodeFile', 'Decode a file', '為檔案解碼'),
                  ('copy', 'Copy Base64 output', '複製 Base64 輸出'), ('dataUrl', 'Copy a data: URL', '複製 data: URL'), ('saveFile', 'Save Base64 output to a file', '把 Base64 輸出存成檔案')]:
    s('b64.hist.' + k, en, zh)

# ---- history ----------------------------------------------------------------------------------
s('hist.undo', 'Undo', '復原'); s('hist.redo', 'Redo', '重做'); s('hist.nothingUndo', 'Nothing to undo.', '沒有可復原的動作。'); s('hist.nothingRedo', 'Nothing to redo.', '沒有可重做的動作。')
s('hist.leadGit', 'Every action is a Git commit in your local workspace (branch {0}). Undo and redo are new commits, so nothing is lost.', '每個動作都是本機工作區的一個 Git 提交（分支 {0}）。復原及重做都是新的提交，不會遺失任何內容。')
s('hist.leadJsonl', 'Git is not installed, so the built-in history file keeps every action. Undo and redo work the same way.', '未安裝 Git，所以由內置記錄檔保存每個動作。復原及重做的運作方式相同。')
s('hist.noGit', 'Git was not found: history uses the built-in store.', '找不到 Git：記錄改用內置儲存。'); s('hist.gitError', 'Git could not be used ({0}); the built-in store is active.', '無法使用 Git（{0}）；已改用內置儲存。')
s('hist.backendGit', 'History backend: Git repository at %LOCALAPPDATA%\\TempDesk\\workspace.', '記錄後端：位於 %LOCALAPPDATA%\\TempDesk\\workspace 的 Git 儲存庫。'); s('hist.backendJsonl', 'History backend: built-in history file (install Git for branches, push and a full Git log).', '記錄後端：內置記錄檔（安裝 Git 可使用分支、推送及完整 Git 記錄）。')
s('hist.pick', 'Pick an entry to see what changed.', '請選擇一個項目以查看變更。'); s('hist.search', 'Search history', '搜尋記錄'); s('hist.filter', 'Show', '顯示')
for k, en, zh in [('all', 'All', '全部'), ('change', 'Changes', '變更'), ('undo', 'Undo', '復原'), ('redo', 'Redo', '重做'), ('restore', 'Restores', '還原'), ('start', 'Start', '開始')]:
    s('hist.kind.' + k, en, zh)
s('hist.current', 'current', '目前'); s('hist.view', 'View changes', '查看變更'); s('hist.restore', 'Restore this version', '還原此版本'); s('hist.copyId', 'Copy commit id', '複製提交編號')
s('hist.compareStart', 'Compare from here', '由此比較'); s('hist.compareWith', 'Compare with the marked version', '與標記的版本比較'); s('hist.compareNext', 'Now pick the second version.', '請選擇第二個版本。'); s('hist.compareTitle', '{0} → {1}', '{0} → {1}')
s('hist.diff', 'Changes', '變更'); s('hist.noChanges', 'No file changes in this entry.', '此項目沒有檔案變更。'); s('hist.allFiles', 'All files', '所有檔案'); s('hist.file', 'File', '檔案')
s('hist.empty', 'No actions recorded yet.', '暫時沒有記錄動作。'); s('hist.noMatch', 'Nothing matches the search.', '沒有符合搜尋的項目。')
s('hist.setField', 'Set {0} to {1}', '把{0}設為 {1}'); s('hist.saveDep', 'Save deployment {0}', '儲存部署 {0}'); s('hist.dupDep', 'Duplicate deployment {0} as {1}', '把部署 {0} 複製為 {1}'); s('hist.importDep', 'Import deployment {0}', '匯入部署 {0}')
s('hist.advOn', 'Use advanced deploy', '使用進階部署'); s('hist.advOff', 'Use the unattended monitor', '使用無人值守監察'); s('hist.sshKey', 'Use the TempDesk SSH key', '使用 TempDesk SSH 金鑰')
s('hist.onboarding', 'Start onboarding again', '重新開始入門設定'); s('hist.onboardDone', 'Finish onboarding', '完成入門設定')

# ---- settings ---------------------------------------------------------------------------------
s('set.lead', 'Every setting explains itself. Search finds any of them.', '每項設定都附有說明。搜尋可找到任何設定。'); s('set.search', 'Search settings', '搜尋設定'); s('set.searchPh', 'Search settings (plain text or regex)', '搜尋設定（純文字或正規表示式）')
for k, en, zh in [('appearance', 'Appearance', '外觀'), ('language', 'Language and tone', '語言及語氣'), ('sound', 'Sound', '音效'), ('school', 'School mode', '學校模式'), ('history', 'History, Git and updates', '記錄、Git 及更新'), ('data', 'Import, export and backup', '匯入、匯出及備份'), ('about', 'About', '關於')]:
    s('set.sec.' + k, en, zh)
SETTINGS = [('theme', 'Theme', '主題', 'Dark, light, or follow Windows.', '深色、淺色或跟隨 Windows。'),
            ('accent', 'Accent colour', '強調色', 'Drag on the wheel, use the arrow keys, or type a hex value. The contrast is checked as you go.', '在色輪上拖動、使用方向鍵或輸入十六進位值。會即時檢查對比度。'),
            ('radius', 'Corner radius', '圓角', 'How round cards, dialogs and buttons are.', '卡片、對話方塊及按鈕的圓角程度。'), ('density', 'Density', '密度', 'Space between controls and the size of touch targets.', '控制項之間的空間及觸控目標大小。'),
            ('textScale', 'Text size', '文字大小', 'From 90 to 160 percent. Layouts reflow instead of clipping.', '90% 至 160%。版面會重新排列而不會被截斷。'),
            ('highContrast', 'High contrast', '高對比', 'Follow Windows contrast themes, or force strong outlines on or off.', '跟隨 Windows 對比主題，或強制開啟或關閉粗外框。'),
            ('motion', 'Motion', '動態效果', 'Animations follow the Windows "Show animations" setting unless you choose here.', '除非在此選擇，動畫會跟隨 Windows 的「顯示動畫」設定。'),
            ('appName', 'App name', '應用程式名稱', 'Shown in the title bar, the taskbar and About.', '顯示在標題列、工作列及「關於」。'), ('logo', 'Title bar logo', '標題列標誌', 'Pick a PNG, JPEG, GIF or WebP image (up to 200 KiB).', '選擇 PNG、JPEG、GIF 或 WebP 圖片（最多 200 KiB）。'),
            ('language', 'Language', '語言', 'English, Cantonese (Traditional Chinese, Hong Kong), or both side by side.', '英文、粵語（繁體中文，香港）或並排顯示兩者。'),
            ('funny', 'Funny level', '搞笑程度', 'Changes the tone of friendly copy only. Errors, warnings and security text always stay serious.', '只改變友善文字的語氣。錯誤、警告及安全文字永遠保持正經。'),
            ('wording', 'Personal wording', '個人用詞', 'Replace interface words with your own (upload or drop a JSON file anywhere on the window). Data such as host names, paths and logs is never changed.', '以你自己的用詞取代介面文字（上載或把 JSON 檔案拖放到視窗任何位置）。主機名稱、路徑及記錄等資料永不變更。'),
            ('sounds', 'Action sounds', '動作音效', 'Plays the Windows sounds for success, errors and celebrations.', '在成功、錯誤及慶祝時播放 Windows 音效。'), ('volume', 'Volume', '音量', 'Volume of action sounds.', '動作音效的音量。'),
            ('schoolMode', 'School mode', '學校模式', 'Forces English and hides the funny level, personal wording and playful extras until it is unlocked with a PIN.', '強制使用英文，並隱藏搞笑程度、個人用詞及趣味功能，直至以 PIN 解鎖。'),
            ('gitRemote', 'Push to a remote', '推送到遠端', 'Optional Git remote for the workspace. Credentials are never stored here: Git Credential Manager handles sign-in.', '工作區的選用 Git 遠端。這裏永不儲存認證：由 Git Credential Manager 處理登入。'),
            ('updates', 'Automatic update check', '自動檢查更新', 'Checks GitHub releases in the background and asks before restarting. Packages are not code-signed.', '在背景檢查 GitHub 發行版本，並在重新啟動前詢問。套件沒有程式碼簽署。'),
            ('settingsIo', 'Settings file', '設定檔', 'Export these settings to JSON, or import them (validated in full before anything changes).', '把設定匯出為 JSON，或匯入設定（在變更前會完整驗證）。'),
            ('backup', 'Backup everything', '備份全部', 'One .zip with settings, tabs, deployments and the workspace history files. No passwords, keys or personal wording.', '一個 .zip 包含設定、分頁、部署及工作區記錄檔，不含密碼、金鑰或個人用詞。'),
            ('onboarding', 'Onboarding', '入門設定', 'Run the first-run wizard again.', '再次執行首次使用精靈。')]
for k, en, zh, hen, hzh in SETTINGS:
    s('set.' + ('school' if k == 'schoolMode' else k), en, zh)
    s('set.' + ('school' if k == 'schoolMode' else k) + 'Help', hen, hzh)
    s('info.' + k, hen, hzh)
s('set.accentWheel', 'Accent colour wheel', '強調色色輪'); s('set.accentHex', 'Hex colour', '十六進位顏色'); s('set.accentReset', 'Reset', '重設')
s('set.contrast', 'Contrast {0}:1 on the background, {1}:1 for text on the accent.', '對背景的對比度 {0}:1，強調色上文字的對比度 {1}:1。'); s('set.contrastOk', 'Readable.', '清晰可讀。'); s('set.contrastLow', 'Low contrast: light mode darkens it automatically.', '對比度偏低：淺色模式會自動調暗。')
s('set.appNameBad', 'Use 1 to 40 characters without < or >.', '請使用 1 至 40 個字元，不可包含 < 或 >。'); s('set.logoPick', 'Choose image', '選擇圖片'); s('set.logoReset', 'Use the default logo', '使用預設標誌')
s('set.logoTooLarge', 'The image is larger than 200 KiB.', '圖片大於 200 KiB。'); s('set.logoBad', 'That file is not a PNG, JPEG, GIF or WebP image.', '該檔案不是 PNG、JPEG、GIF 或 WebP 圖片。')
s('set.languageSchool', 'School mode is on: the interface stays in English.', '學校模式已開啟：介面保持英文。'); s('set.test', 'Test', '測試')
s('set.gitSave', 'Save remote', '儲存遠端'); s('set.gitSaved', 'Remote saved.', '已儲存遠端。'); s('set.gitPush', 'Push now', '立即推送'); s('set.gitPushed', 'Pushed.', '已推送。'); s('set.gitPushFailed', 'Push failed: {0}', '推送失敗：{0}')
s('set.updatesPortable', 'Updates work when the app is installed with Setup.exe. The portable copy does not update itself.', '以 Setup.exe 安裝時才會更新。可攜版不會自行更新。')
s('set.export', 'Export', '匯出'); s('set.import', 'Import', '匯入'); s('set.onboardingRun', 'Run onboarding', '執行入門設定')
for k, en, zh in [('dark', 'Dark', '深色'), ('light', 'Light', '淺色'), ('system', 'Follow Windows', '跟隨 Windows'), ('compact', 'Compact', '緊湊'), ('comfortable', 'Comfortable', '舒適'), ('spacious', 'Spacious', '寬敞'),
                  ('on', 'On', '開啟'), ('off', 'Off', '關閉'), ('motionSystem', 'Follow Windows "Show animations"', '跟隨 Windows「顯示動畫」')]:
    s('opt.' + k, en, zh)
s('lang.en', 'English', 'English'); s('lang.zh-HK', 'Cantonese (Traditional Chinese, Hong Kong)', '粵語（繁體中文，香港）'); s('lang.bilingual', 'Bilingual (English and Cantonese)', '雙語（英文及粵語）')
for i, (en, zh) in enumerate([('Serious', '正經'), ('Friendly', '友善'), ('Playful', '活潑'), ('Silly', '搞笑')]):
    s('funny.' + str(i), en, zh)
s('wording.upload', 'Upload wording file', '上載用詞檔'); s('wording.clear', 'Restore original wording', '還原原有用詞'); s('wording.cleared', 'Original wording restored.', '已還原原有用詞。')
s('wording.active', 'Personal wording is on ({0} replacements).', '個人用詞已開啟（{0} 個取代）。'); s('wording.none', 'No personal wording.', '沒有個人用詞。')
tone('wording.applied', ['Personal wording applied', 'Personal wording applied', 'Personal wording applied', 'Personal wording applied'], ['已套用個人用詞', '已套用個人用詞', '已套用個人用詞', '已套用個人用詞'])
s('wording.schemaBtn', 'File format', '檔案格式'); s('wording.schemaTitle', 'Personal wording file', '個人用詞檔'); s('wording.schemaHelp', 'A UTF-8 JSON file like this example. Each entry replaces whole words in the interface.', '類似此例子的 UTF-8 JSON 檔案。每個項目會取代介面中完整的字詞。')
s('wording.rules', 'Up to 256 KiB, nesting up to 8 levels, no duplicate keys, keys 1 to 160 characters (not __proto__, prototype or constructor), values up to 1000 characters, no control characters. An invalid file changes nothing.', '最多 256 KiB，巢狀最多 8 層，不可有重複鍵，鍵長 1 至 160 個字元（不可為 __proto__、prototype 或 constructor），值最多 1000 個字元，不可有控制字元。無效檔案不會作任何變更。')
s('wording.schoolBlocked', 'Personal wording is off in school mode.', '學校模式下不可使用個人用詞。')
for k, en, zh in [('size', 'The file is larger than 256 KiB. Nothing changed.', '檔案大於 256 KiB。沒有任何變更。'), ('empty', 'The file is empty. Nothing changed.', '檔案是空的。沒有任何變更。'), ('utf8', 'The file is not UTF-8 text. Nothing changed.', '檔案不是 UTF-8 文字。沒有任何變更。'),
                  ('json', 'The file is not valid JSON. Nothing changed.', '檔案不是有效的 JSON。沒有任何變更。'), ('depth', 'The file is nested deeper than 8 levels. Nothing changed.', '檔案巢狀超過 8 層。沒有任何變更。'),
                  ('duplicate', 'The file has a duplicate key. Nothing changed.', '檔案有重複的鍵。沒有任何變更。'), ('topObject', 'The file must be a JSON object. Nothing changed.', '檔案必須是 JSON 物件。沒有任何變更。'),
                  ('topKeys', 'Only schemaVersion and entries are allowed at the top level. Nothing changed.', '最上層只可有 schemaVersion 及 entries。沒有任何變更。'), ('schemaVersion', 'schemaVersion must be 1. Nothing changed.', 'schemaVersion 必須是 1。沒有任何變更。'),
                  ('entries', 'entries must be an object. Nothing changed.', 'entries 必須是物件。沒有任何變更。'), ('keyLength', 'Entry {0}: the key must be 1 to 160 characters. Nothing changed.', '第 {0} 項：鍵必須是 1 至 160 個字元。沒有任何變更。'),
                  ('keyBlank', 'Entry {0}: the key is blank. Nothing changed.', '第 {0} 項：鍵是空白的。沒有任何變更。'), ('keyReserved', 'Entry {0}: that key name is not allowed. Nothing changed.', '第 {0} 項：不允許使用該鍵名稱。沒有任何變更。'),
                  ('keyControl', 'Entry {0}: the key has a control character. Nothing changed.', '第 {0} 項：鍵含有控制字元。沒有任何變更。'), ('valueType', 'Entry {0}: the value must be text. Nothing changed.', '第 {0} 項：值必須是文字。沒有任何變更。'),
                  ('valueLength', 'Entry {0}: the value is longer than 1000 characters. Nothing changed.', '第 {0} 項：值超過 1000 個字元。沒有任何變更。'), ('valueControl', 'Entry {0}: the value has a control character. Nothing changed.', '第 {0} 項：值含有控制字元。沒有任何變更。')]:
    s('wording.invalid.' + k, en, zh)
s('drop.notWording', 'That JSON file is not a personal wording file.', '該 JSON 檔案不是個人用詞檔。'); s('drop.unknown', 'Drop a personal wording JSON file here, or use the Base64 page for other files.', '請把個人用詞 JSON 檔案拖放到這裏，或在 Base64 頁面處理其他檔案。')
s('school.notSecurity', 'School mode is a convenience lock for classrooms, not a security feature: anyone who can edit files in this Windows profile can remove it.', '學校模式是方便課室使用的鎖，並非安全功能：任何可編輯此 Windows 設定檔中檔案的人都可移除它。')
s('school.enable', 'Turn on school mode', '開啟學校模式'); s('school.unlock', 'Unlock', '解鎖'); s('school.name', 'Name shown for this mode', '此模式顯示的名稱'); s('school.nameBad', 'Use 1 to 40 characters.', '請使用 1 至 40 個字元。')
s('school.newPin', 'New PIN (4 to 12 digits)', '新 PIN（4 至 12 位數字）'); s('school.repeatPin', 'Repeat the PIN', '再次輸入 PIN'); s('school.pin', 'PIN', 'PIN'); s('school.pinBad', 'Use 4 to 12 digits.', '請使用 4 至 12 位數字。')
s('school.pinMismatch', 'The PINs do not match.', 'PIN 不相符。'); s('school.wrongPin', 'Wrong PIN.', 'PIN 錯誤。'); s('school.on', '{0} is on', '{0} 已開啟'); s('school.off', 'School mode is off.', '學校模式已關閉。')
s('backup.saved', 'Backup saved to {0}', '已把備份儲存到 {0}'); s('backup.restore', 'Restore from backup', '從備份還原'); s('backup.restoreTitle', 'Restore a backup', '還原備份')
s('backup.restoreWarn', 'Settings, tabs and deployments from the backup replace the current ones. The whole file is checked first; if anything is invalid nothing changes.', '備份中的設定、分頁及部署會取代目前的內容。會先檢查整個檔案；如有任何無效內容，則不會作任何變更。')
s('backup.restoreHold', 'Hold to restore', '按住以還原'); s('backup.restored', 'Restored {0} files.', '已還原 {0} 個檔案。'); s('backup.restoreBad', 'The backup was not restored: {0}', '未能還原備份：{0}')
for k, en, zh in [('backup.schema', 'it is not a TempDesk backup', '它不是 TempDesk 備份'), ('backup.files', 'its file list is damaged', '其檔案清單已損壞'), ('backup.path', 'it contains an unexpected file path', '它包含意料之外的檔案路徑'), ('backup.missing', 'a listed file is missing', '清單中的檔案不見了'),
                  ('backup.json', 'a file is not valid JSON', '有檔案不是有效的 JSON'), ('backup.settings', 'its settings are not valid', '其設定無效'), ('backup.vocabulary', 'its personal wording file is not valid', '其個人用詞檔無效'), ('backup.deployment', 'a deployment is not valid', '有部署無效'),
                  ('zip.format', 'it is not a zip file', '它不是 zip 檔案'), ('zip.path', 'it contains an unsafe path', '它包含不安全的路徑'), ('zip.size', 'it is too large', '它太大'), ('zip.count', 'it has too many files', '檔案太多'), ('zip.crc', 'a file inside is damaged', '內裏有檔案已損壞'),
                  ('zip.method', 'it uses unsupported compression', '它使用不支援的壓縮方式'), ('zip.duplicate', 'it lists a file twice', '有檔案重複列出')]:
    s('err.' + k, en, zh)
s('about.name', 'Name', '名稱'); s('about.version', 'Version', '版本'); s('about.commit', 'Commit', '提交'); s('about.built', 'Built (UTC)', '建置時間（UTC）'); s('about.runtime', 'Runtime', '執行環境'); s('about.data', 'Local data', '本機資料')
s('about.signing', 'Code signing', '程式碼簽署'); s('about.unsigned', 'Not signed (owner decision). Windows SmartScreen may warn on first run.', '沒有簽署（擁有者決定）。首次執行時 Windows SmartScreen 可能會發出警告。')
s('update.region', 'Update', '更新'); s('update.ready', 'Update {0} is ready. Restart to use it.', '更新 {0} 已準備好。重新啟動以使用。'); s('update.unsigned', 'The package is not code-signed.', '套件沒有程式碼簽署。')
s('update.restart', 'Restart now', '立即重新啟動'); s('update.later', 'Later', '稍後')
for k, en, zh in [('idle', 'No update check has run yet.', '仲未檢查更新。'), ('checking', 'Checking for updates...', '正在檢查更新……'), ('downloading', 'Downloading {0}...', '正在下載 {0}……'), ('ready', 'Update {0} is ready.', '更新 {0} 已準備好。'),
                  ('current', 'You have the latest version.', '你已在使用最新版本。'), ('error', 'The update check failed.', '檢查更新失敗。'), ('unavailable', 'Updates work only when installed with Setup.exe.', '只有以 Setup.exe 安裝時才可更新。')]:
    s('update.state.' + k, en, zh)

# ---- tabs, actions, help, onboarding ----------------------------------------------------------
s('tabs.open', 'Open', '開啟'); s('tabs.close', 'Close {0}', '關閉 {0}'); s('tabs.closeOthers', 'Close other tabs', '關閉其他分頁'); s('tabs.moveLeft', 'Move left', '向左移'); s('tabs.moveRight', 'Move right', '向右移')
for k, en, zh in [('newServer', 'New Windows Server deployment', '新增 Windows Server 部署'), ('newLite', 'New TempDesk Lite deployment', '新增 TempDesk Lite 部署'), ('undo', 'Undo', '復原'), ('redo', 'Redo', '重做'), ('notifications', 'Show notifications', '顯示通知'),
                  ('backup', 'Backup everything (.zip)', '備份全部（.zip）'), ('checkUpdates', 'Check for updates', '檢查更新'), ('changelog', 'Show the changelog', '顯示變更記錄'), ('docs', 'Browse the documentation', '瀏覽文件')]:
    s('act.' + k, en, zh)
s('set.darkTheme', 'Dark theme', '深色主題'); s('set.motionOff', 'Turn animations off', '關閉動畫')
s('help.lead', 'Documentation and release notes bundled with the app, available offline.', '隨應用程式附帶的文件及版本說明，離線亦可使用。')
s('help.tab.docs', 'Docs', '文件'); s('help.tab.changelog', 'Changelog', '變更記錄'); s('help.tab.shortcuts', 'Keyboard shortcuts', '鍵盤快速鍵')
s('help.searchDocs', 'Search the documentation', '搜尋文件'); s('help.searchChangelog', 'Search the changelog', '搜尋變更記錄'); s('help.noDocs', 'No documentation is bundled with this build.', '此版本沒有附帶文件。')
s('help.noChangelog', 'No changelog is bundled with this build.', '此版本沒有附帶變更記錄。'); s('help.linkBlocked', 'That link is not on the list of allowed sites.', '該連結不在允許的網站清單內。')
for k, en, zh in [('palette', 'Command palette: search every page, setting and action', '指令面板：搜尋所有頁面、設定及動作'), ('pages', 'Go to page 1 to 8 in the navigation rail', '前往導覽列的第 1 至 8 頁'), ('undo', 'Undo the last action (a new commit)', '復原上一個動作（新的提交）'),
                  ('redo', 'Redo (a new commit)', '重做（新的提交）'), ('tabs', 'Next or previous deployment tab', '下一個或上一個部署分頁'), ('closeTab', 'Close the deployment tab', '關閉部署分頁'), ('moveTab', 'Move the focused tab', '移動焦點所在的分頁'),
                  ('context', 'Open the context menu of the focused item', '開啟焦點項目的快顯功能表'), ('studioFiles', 'Studio: new blank, open, save, save as', '工作室：新增空白、開啟、儲存、另存新檔'), ('help', 'Open help', '開啟說明'), ('close', 'Close a dialog, menu or popup', '關閉對話方塊、功能表或彈出視窗')]:
    s('key.' + k, en, zh)
tone('onb.welcome', ['Welcome to TempDesk Deployer', 'Welcome to TempDesk Deployer', 'Hello! Let us set things up', 'Oh hi, new friend'], ['歡迎使用 TempDesk Deployer', '歡迎使用 TempDesk Deployer', '你好！一齊設定吓', '哈囉，新朋友'])
s('onb.welcomeLead', 'A few quick steps: choose how you will run TempDesk, check this PC, pick a look.', '幾個簡單步驟：選擇 TempDesk 的執行方式、檢查此電腦、挑選外觀。')
s('onb.welcomeBody', 'Your progress is saved after each step, so you can close the app and continue later.', '每一步之後都會儲存進度，你可以關閉應用程式稍後再繼續。')
s('onb.path', 'How will you run TempDesk?', '你會如何執行 TempDesk？'); s('onb.pathLead', 'You can create both kinds later.', '稍後可以兩種都建立。')
s('onb.path.server', 'Windows Server 2025 Core', 'Windows Server 2025 Core'); s('onb.path.server.help', 'Unattended install media; the server becomes the domain controller and finishes TempDesk by itself.', '無人值守安裝媒體；伺服器會成為網域控制站並自行完成 TempDesk。')
s('onb.path.lite', 'TempDesk Lite on Linux', 'Linux 上的 TempDesk Lite'); s('onb.path.lite.help', 'A Samba domain controller container on a Linux host, deployed over SSH.', '經 SSH 部署到 Linux 主機的 Samba 網域控制站容器。')
s('onb.prereqs', 'Check this PC', '檢查此電腦'); s('onb.prereqLead', 'These are checked for real on this PC.', '以下項目會在此電腦實際檢查。'); s('onb.checking', 'Checking...', '檢查中……'); s('onb.recheck', 'Check again', '再檢查')
s('onb.found', 'Found', '已找到'); s('onb.missing', 'Missing', '缺少'); s('onb.optional', 'Optional', '選用')
for k, en, zh, fen, fzh in [('powershell', 'Windows PowerShell', 'Windows PowerShell', 'Windows PowerShell is part of Windows. Repair Windows if it is missing.', 'Windows PowerShell 是 Windows 內置的。如缺少，請修復 Windows。'),
                            ('openssh', 'OpenSSH client', 'OpenSSH 用戶端', 'Settings > System > Optional features > Add OpenSSH Client.', '設定 > 系統 > 選用功能 > 新增 OpenSSH 用戶端。'),
                            ('docker', 'Docker', 'Docker', 'Needed only to run the portals on this PC: install Docker Desktop.', '只有在此電腦執行入口網站時才需要：請安裝 Docker Desktop。'),
                            ('git', 'Git', 'Git', 'Optional: install Git for Windows for a full Git history, branches and push.', '選用：安裝 Git for Windows 以使用完整 Git 記錄、分支及推送。'),
                            ('network', 'Network', '網絡', 'Connect this PC to the network the server will use.', '請把此電腦連接到伺服器將使用的網絡。')]:
    s('onb.pr.' + k, en, zh); s('onb.pr.' + k + '.fix', fen, fzh)
s('onb.psMissing', 'Windows PowerShell was not found. Deployments cannot run.', '找不到 Windows PowerShell。無法執行部署。')
s('onb.look', 'Language and look', '語言及外觀'); s('onb.lookLead', 'Change these any time in Settings.', '可隨時在「設定」更改。')
tone('onb.done', ['All set', 'All set', 'Ready to roll', 'Let the domain-building begin'], ['設定完成', '設定完成', '準備就緒', '開始起網域啦'])
s('onb.doneBody.server', 'The Deploy page opens with Windows Server Core selected. Build the media first.', '「部署」頁面會以 Windows Server Core 開啟。請先建立媒體。')
s('onb.doneBody.lite', 'The Deploy page opens with TempDesk Lite selected. Create an SSH key first.', '「部署」頁面會以 TempDesk Lite 開啟。請先建立 SSH 金鑰。')
s('onb.kicker', 'Step {0} of {1}', '第 {0} 步，共 {1} 步'); s('onb.progress', 'Onboarding progress', '入門設定進度')
s('onb.back', 'Back', '上一步'); s('onb.next', 'Next', '下一步'); s('onb.skip', 'Skip', '略過'); s('onb.open', 'Open the workspace', '開啟工作區'); s('onb.escHint', 'Use Skip or Next to continue. Your progress is saved.', '請按「略過」或「下一步」繼續。進度已儲存。')

# ---- info popovers -------------------------------------------------------------------------
for k, en, zh in [('password', 'Typed passwords stay in memory for this session. They reach the engine through an environment variable of the child process, never a file, a command line or a log.', '輸入的密碼只在本次工作階段的記憶體中保留。它們經子程序的環境變數傳給引擎，永不寫入檔案、指令列或記錄。'),
                  ('depName', 'Used for the protected folder %LOCALAPPDATA%\\TempDesk\\deployments\\<name> that holds agent.json and the portal settings.', '用作受保護資料夾 %LOCALAPPDATA%\\TempDesk\\deployments\\<名稱> 的名稱，該資料夾存放 agent.json 及入口網站設定。'),
                  ('domain', 'A DNS name you control, such as lab.example.org. Avoid .local.', '你控制的 DNS 名稱，例如 lab.example.org。請避免使用 .local。'), ('netbios', 'The short domain name (up to 15 characters) that older tools show, such as LAB.', '舊式工具顯示的短網域名稱（最多 15 個字元），例如 LAB。'),
                  ('prefix', 'The subnet size in bits: 24 means 255.255.255.0.', '以位元表示的子網大小：24 即 255.255.255.0。'), ('dns', 'Use 127.0.0.1 so the new domain controller answers its own DNS. Add a forwarder later in the admin console.', '使用 127.0.0.1，讓新網域控制站回應自己的 DNS。稍後可在管理主控台加入轉寄站。'),
                  ('imageIndex', 'The edition inside install.wim. Index 1 is Standard (Server Core) on Windows Server 2025 media.', 'install.wim 中的版本。在 Windows Server 2025 媒體上，索引 1 為 Standard（Server Core）。'),
                  ('firmware', 'UEFI uses GPT partitions; legacy BIOS uses MBR. Virtual machines are usually UEFI.', 'UEFI 使用 GPT 分割區；傳統 BIOS 使用 MBR。虛擬機通常是 UEFI。'), ('locale', 'A language tag such as en-US or zh-HK for the system and user locale.', '用於系統及使用者地區設定的語言標籤，例如 en-US 或 zh-HK。'),
                  ('portalsMode', 'Native installs the portals on the server itself; otherwise run them with Docker from the Portals page.', '原生會把入口網站安裝在伺服器上；否則可在「入口網站」頁面以 Docker 執行。'),
                  ('advanced', 'Use this when Windows Server is already installed. The unattended media path needs no action after boot.', '當 Windows Server 已安裝時使用。無人值守媒體方式在開機後無須任何操作。'),
                  ('acceptNew', 'Adds an unknown host key on the first connection (accept-new). Changed keys are still refused.', '首次連線時加入未知的主機金鑰（accept-new）。金鑰變更仍會被拒絕。'),
                  ('sshAuth', 'Key sign-in is recommended. For a password, open the first connection in a console window and sign in there; the desktop app never sees the password.', '建議使用金鑰登入。如使用密碼，請在主控台視窗進行首次連線並在該處登入；桌面應用程式永不會看到密碼。'),
                  ('remoteDir', 'Folder in the SSH user\'s home where samba/, client/, portal/ and streaming/ are uploaded.', 'SSH 使用者主目錄中上載 samba/、client/、portal/ 及 streaming/ 的資料夾。'),
                  ('dcIp', 'A free address on your LAN, outside the DHCP pool. The container gets it through macvlan.', '區域網絡中未使用、在 DHCP 範圍以外的位址。容器經 macvlan 取得此位址。'),
                  ('macvlan', 'The Linux interface on the LAN (see "ip link"), for example eth0 or enp3s0.', '區域網絡上的 Linux 介面（見「ip link」），例如 eth0 或 enp3s0。'),
                  ('portalsWhere', 'Docker Desktop on this PC, or the Lite host that already runs Docker.', '此電腦上的 Docker Desktop，或已執行 Docker 的 Lite 主機。'), ('portalsHost', 'Shown in the links and the QR code; the portals listen on every interface.', '顯示於連結及 QR 碼；入口網站會在所有介面監聽。'),
                  ('studio', 'The same Answer File Studio as the website, with desktop extras: real files, recent files, file watching, Git branches per variant, ISO and USB.', '與網站相同的應答檔案工作室，並加入桌面功能：真實檔案、最近的檔案、檔案監察、每個變體一個 Git 分支、ISO 及 USB。'),
                  ('b64variant', 'Standard uses + and /; URL-safe uses - and _; MIME wraps lines at 76 characters with CRLF.', '標準使用 + 及 /；URL 安全使用 - 及 _；MIME 以 CRLF 在 76 個字元處換行。'),
                  ('b64line', 'Wrap the output every N characters (0 keeps one line).', '每 N 個字元換行（0 保持一行）。'), ('b64enc', 'How text is turned into bytes before encoding, and back after decoding.', '編碼前如何把文字轉為位元組，以及解碼後如何轉回。')]:
    s('info.' + k, en, zh)


def main():
    keys = [k for k, _, _ in E]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise SystemExit('duplicate keys: ' + ', '.join(dup))
    for lang, idx in (('en', 1), ('zh-HK', 2)):
        obj = {k: (en if idx == 1 else zh) for k, en, zh in E}
        # Bytes, not text: the catalogs are LF on every platform (text mode writes CRLF on Windows).
        (HERE / (lang + '.json')).write_bytes((json.dumps(dict(sorted(obj.items())), ensure_ascii=False, indent=1) + '\n').encode('utf-8'))
    print('wrote', len(E), 'keys')


if __name__ == '__main__':
    main()

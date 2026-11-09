#Requires -Modules Pester
# Pester 5 tests for the pure engine functions. Run: Invoke-Pester deployer/engine/tests
BeforeDiscovery {
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot '../../..')
    $hasNode = [bool](Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $repoRoot 'site/assets/answer.js'))
    $hasFirstboot = Test-Path (Join-Path $repoRoot 'server/firstboot/Continue-Setup.ps1')
}
BeforeAll {
    $engine = Split-Path -Parent $PSScriptRoot
    foreach ($m in 'TempDesk.Common', 'AnswerFile', 'Vocabulary', 'ServerDeploy', 'LiteDeploy', 'Portals') {
        Import-Module (Join-Path $engine "$m.psm1") -Force -DisableNameChecking
    }
    $fixtures = Get-Content (Join-Path $PSScriptRoot 'fixtures/forms.json') -Raw | ConvertFrom-Json -AsHashtable
    $script:repo = Resolve-Path (Join-Path $engine '../..')
    function Get-Xml([string] $Text) { $x = New-Object System.Xml.XmlDocument; $x.LoadXml($Text); $x }
    function Get-Ns($x) { $ns = New-Object System.Xml.XmlNamespaceManager($x.NameTable); $ns.AddNamespace('u', 'urn:schemas-microsoft-com:unattend'); , $ns }
}

Describe 'Unattend password encoding' {
    It 'matches the Windows encoding for the Administrator password' {
        # base64(UTF-16LE("Pass1!" + "AdministratorPassword"))
        ConvertTo-UnattendPassword -Password 'Pass1!' -Suffix AdministratorPassword |
            Should -Be ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Pass1!AdministratorPassword')))
    }
    It 'uses the Password suffix for AutoLogon and local accounts' {
        ConvertTo-UnattendPassword -Password 'x' -Suffix Password | Should -Be 'eABQAGEAcwBzAHcAbwByAGQA'
    }
    It 'round-trips non-ASCII passwords' {
        $v = ConvertTo-UnattendPassword -Password 'Pässwörd-密碼1' -Suffix AdministratorPassword
        ConvertFrom-UnattendPassword -Value $v -Suffix AdministratorPassword | Should -Be 'Pässwörd-密碼1'
    }
    It 'returns null for values in another encoding' {
        ConvertFrom-UnattendPassword -Value 'not base64!' -Suffix Password | Should -BeNullOrEmpty
        ConvertFrom-UnattendPassword -Value (ConvertTo-UnattendPassword 'a' Password) -Suffix AdministratorPassword | Should -BeNullOrEmpty
    }
}

Describe 'Server answer file' {
    BeforeAll { $script:xmlText = New-TdAnswerFileXml -Mode server -Form $fixtures.server; $script:x = Get-Xml $xmlText; $script:ns = Get-Ns $x }
    It 'is well-formed XML with CRLF line endings' { $xmlText | Should -Match "`r`n"; $x.DocumentElement.LocalName | Should -Be 'unattend' }
    It 'wipes disk 0 with EFI 300, MSR 16 and Windows on the rest (UEFI)' {
        $cp = $x.SelectNodes('//u:DiskConfiguration/u:Disk/u:CreatePartitions/u:CreatePartition', $ns)
        $cp.Count | Should -Be 3
        $cp[0].Type | Should -Be 'EFI'; $cp[0].Size | Should -Be '300'
        $cp[1].Type | Should -Be 'MSR'; $cp[1].Size | Should -Be '16'
        $cp[2].Extend | Should -Be 'true'
        $x.SelectSingleNode('//u:DiskConfiguration/u:Disk/u:WillWipeDisk', $ns).InnerText | Should -Be 'true'
        $x.SelectSingleNode('//u:ImageInstall/u:OSImage/u:InstallTo/u:PartitionID', $ns).InnerText | Should -Be '3'
    }
    It 'uses image index 1 (Standard Core) by default and honours an override' {
        $x.SelectSingleNode('//u:InstallFrom/u:MetaData/u:Value', $ns).InnerText | Should -Be '1'
        $b = Get-Xml (New-TdAnswerFileXml -Mode server -Form $fixtures.serverBios)
        $b.SelectSingleNode('//u:InstallFrom/u:MetaData/u:Value', (Get-Ns $b)).InnerText | Should -Be '3'
    }
    It 'supports the legacy BIOS MBR layout' {
        $b = Get-Xml (New-TdAnswerFileXml -Mode server -Form $fixtures.serverBios); $bn = Get-Ns $b
        $b.SelectNodes('//u:CreatePartition', $bn).Count | Should -Be 2
        $b.SelectSingleNode('//u:ModifyPartition/u:Active', $bn).InnerText | Should -Be 'true'
        $b.SelectSingleNode('//u:InstallTo/u:PartitionID', $bn).InnerText | Should -Be '2'
        $b.SelectSingleNode('//u:ProductKey/u:Key', $bn).InnerText | Should -Be 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE'
    }
    It 'sets ComputerName and time zone in specialize' {
        $x.SelectSingleNode("//u:settings[@pass='specialize']//u:ComputerName", $ns).InnerText | Should -Be 'TD-DC01'
        $x.SelectSingleNode("//u:settings[@pass='specialize']//u:TimeZone", $ns).InnerText | Should -Be 'China Standard Time'
    }
    It 'encodes the Administrator password (PlainText false) and one-time AutoLogon' {
        $ap = $x.SelectSingleNode('//u:UserAccounts/u:AdministratorPassword', $ns)
        $ap.PlainText | Should -Be 'false'
        ConvertFrom-UnattendPassword -Value $ap.Value -Suffix AdministratorPassword | Should -Be 'Example-Pass-123'
        $al = $x.SelectSingleNode('//u:AutoLogon', $ns)
        $al.LogonCount | Should -Be '1'
        ConvertFrom-UnattendPassword -Value $al.Password.Value -Suffix Password | Should -Be 'Example-Pass-123'
        $xmlText | Should -Not -Match 'Example-Pass-123'
    }
    It 'runs TempDesk\FirstLogon.ps1 from whichever drive holds it' {
        $cmd = $x.SelectSingleNode('//u:FirstLogonCommands/u:SynchronousCommand/u:CommandLine', $ns).InnerText
        $cmd | Should -Match 'Get-PSDrive -PSProvider FileSystem'
        $cmd | Should -Match "TempDesk\\FirstLogon\.ps1"
    }
    It 'escapes XML special characters in passwords and names' {
        $b = New-TdAnswerFileXml -Mode server -Form $fixtures.serverBios
        { Get-Xml $b } | Should -Not -Throw
    }
}

Describe 'Guest PC and Custom answer files' {
    It 'joins the domain in specialize with the default TempDesk computers OU and DNS command' {
        $t = New-TdAnswerFileXml -Mode guest -Form $fixtures.guest
        $x = Get-Xml $t; $ns = Get-Ns $x
        $j = $x.SelectSingleNode("//u:component[@name='Microsoft-Windows-UnattendedJoin']/u:Identification", $ns)
        $j.JoinDomain | Should -Be 'lab.example.org'
        $j.MachineObjectOU | Should -Be 'OU=Computers,OU=TempDesk,DC=lab,DC=example,DC=org'
        $j.Credentials.Username | Should -Be 'td-join'
        $x.SelectSingleNode('//u:RunSynchronousCommand/u:Path', $ns).InnerText | Should -Match "Set-DnsClientServerAddress -ServerAddresses '192.168.10.10'"
        $t | Should -Match 'PLAIN TEXT'
    }
    It 'custom mode writes accounts, auto-logon count, features, drivers and RDP' {
        $x = Get-Xml (New-TdAnswerFileXml -Mode custom -Form $fixtures.custom -Commands $fixtures.commands); $ns = Get-Ns $x
        $x.SelectNodes('//u:LocalAccount', $ns).Count | Should -Be 2
        $x.SelectSingleNode('//u:AutoLogon/u:LogonCount', $ns).InnerText | Should -Be '2'
        $x.SelectSingleNode('//u:InstallFrom/u:MetaData/u:Key', $ns).InnerText | Should -Be '/IMAGE/NAME'
        $x.SelectSingleNode('//u:InstallTo/u:PartitionID', $ns).InnerText | Should -Be '4'
        $x.SelectNodes('//u:DiskConfiguration', $ns).Count | Should -Be 0
        $x.SelectSingleNode("//u:settings[@pass='offlineServicing']//u:Path", $ns).InnerText | Should -Be '\\server\share\drv'
        ($x.SelectNodes('//u:FirstLogonCommands/u:SynchronousCommand/u:CommandLine', $ns) | ForEach-Object InnerText) -join ' ' | Should -Match 'Install-WindowsFeature -Name RSAT-AD-Tools,Web-Server'
        $x.SelectSingleNode('//u:fDenyTSConnections', $ns).InnerText | Should -Be 'false'
        $x.SelectSingleNode("//u:RunSynchronousCommand[u:WillReboot='Always']/u:Credentials/u:Username", $ns).InnerText | Should -Be 'svc'
        ($x.SelectNodes('//u:LogonCommands/u:AsynchronousCommand', $ns)).Count | Should -Be 1
    }
}

Describe 'Parity with the shared JavaScript generator' -Tag 'Parity' {
    It 'produces byte-identical XML and firstboot.json' -Skip:(-not $hasNode) {
        $ref = (& node (Join-Path $PSScriptRoot 'fixtures/js-reference.cjs')) | ConvertFrom-Json -AsHashtable
        foreach ($k in $ref.Keys) {
            $mode = $ref[$k].mode
            New-TdAnswerFileXml -Mode $mode -Form $ref[$k].form -Commands $ref[$k].commands | Should -BeExactly $ref[$k].xml -Because "$k xml"
            if ($ref[$k].firstboot) { New-TdFirstbootJson -Form $ref[$k].form | Should -BeExactly $ref[$k].firstboot -Because "$k firstboot" }
        }
    }
}

Describe 'firstboot.json' {
    It 'has the schema Continue-Setup.ps1 reads' {
        $j = New-TdFirstbootJson -Form $fixtures.server | ConvertFrom-Json
        $j.netbiosName | Should -Be 'LAB'
        $j.prefixLength | Should -Be 24
        @($j.dnsServers) | Should -Be @('127.0.0.1', '1.1.1.1')
        $j.portals.mode | Should -Be 'native'
        $j.agent.tls | Should -BeFalse
        $j.initialAdminUser | Should -Be 'Administrator'
        ($j.PSObject.Properties.Name) | Should -Be @('computerName', 'ipAddress', 'prefixLength', 'gateway', 'dnsServers', 'domainName', 'netbiosName', 'functionalLevel', 'dsrmPassword', 'initialAdminUser', 'agent', 'portals')
    }
}

Describe 'Server form validation' {
    It 'accepts the fixture' { (Test-TdServerForm -Form $fixtures.server).Count | Should -Be 0 }
    It 'rejects weak passwords, bad names and bad addresses' {
        $f = $fixtures.server.Clone(); $f.adminPassword = 'short'; $f.computerName = '1234'; $f.ipAddress = '300.1.1.1'; $f.prefixLength = '31'
        $e = Test-TdServerForm -Form $f
        @($e.Keys) | Should -Contain 'adminPassword'
        @($e.Keys) | Should -Contain 'computerName'
        @($e.Keys) | Should -Contain 'ipAddress'
        @($e.Keys) | Should -Contain 'prefixLength'
    }
}

Describe 'Media folder and zip kit' {
    It 'writes autounattend.xml at the root and the TempDesk folder' -Skip:(-not $hasFirstboot) {
        $out = Join-Path ([IO.Path]::GetTempPath()) ('td-media-' + [guid]::NewGuid())
        try {
            New-TdMediaFolder -OutDir $out -Form $fixtures.server -PayloadRoot $repo | Out-Null
            Test-Path (Join-Path $out 'autounattend.xml') | Should -BeTrue
            foreach ($f in 'FirstLogon.ps1', 'Continue-Setup.ps1', 'SetupStatus.ps1', 'firstboot.json', 'server', 'agent', 'client', 'portal') {
                Test-Path (Join-Path $out "TempDesk/$f") | Should -BeTrue -Because $f
            }
            Get-ChildItem (Join-Path $out 'TempDesk') -Recurse -Force -File | Where-Object { $_.Name -match '^\.env(\.guest|\.admin|\.local)?$' } | Should -BeNullOrEmpty
            $zip = New-TdMediaZip -Folder $out -ZipPath "$out.zip"
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $z = [IO.Compression.ZipFile]::OpenRead($zip.FullName)
            try { ($z.Entries | ForEach-Object FullName) | Should -Contain 'autounattend.xml' } finally { $z.Dispose() }
        } finally { Remove-Item $out, "$out.zip" -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Describe 'Progress protocol and secrets' {
    It 'escapes JSON like JSON.stringify' {
        ConvertTo-TdJson ([ordered]@{ a = "q`"`n\"; b = 1; c = $true; d = @(); e = $null }) 0 | Should -BeExactly '{"a":"q\"\n\\","b":1,"c":true,"d":[],"e":null}'
    }
    It 'reads secrets from the environment once and redacts them in logs' {
        $env:TEMPDESK_SECRET_TESTPW = 'Sup3r-Secret!'
        $s = Get-TdSecret -Name TestPw
        $s | Should -BeOfType [System.Security.SecureString]
        $env:TEMPDESK_SECRET_TESTPW | Should -BeNullOrEmpty
        Protect-TdText 'password is Sup3r-Secret! ok' | Should -Be 'password is [redacted] ok'
    }
    It 'records done steps and skips them on resume' {
        $state = Join-Path ([IO.Path]::GetTempPath()) ('td-state-' + [guid]::NewGuid() + '.json')
        Set-TdQuiet $true
        try {
            Initialize-TdState -Path $state -Reset
            $script:count = 0
            Invoke-TdStep -Id 'a' -Title 'A' -Action { $script:count++ }
            { Invoke-TdStep -Id 'b' -Title 'B' -Action { throw 'boom' } } | Should -Throw
            Initialize-TdState -Path $state
            Invoke-TdStep -Id 'a' -Title 'A' -Action { $script:count++ }
            $script:count | Should -Be 1
            Get-TdCompletedSteps | Should -Be @('a')
        } finally { Set-TdQuiet $false; Remove-Item $state -ErrorAction SilentlyContinue }
    }
}

Describe 'Protected folders' {
    It 'can protect the same folder again (a second run of one deployment)' {
        $d = Join-Path $TestDrive 'deployments/again'
        { 1..3 | ForEach-Object { New-TdProtectedDirectory -Path $d -ErrorAction Stop | Out-Null } } | Should -Not -Throw
        Test-Path -LiteralPath $d | Should -BeTrue
    }
}

Describe 'Agent certificate pin' {
    It 'hashes the certificate body and rejects text that is not PEM' {
        $der = [byte[]](1..64)
        $pem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($der) + "`n-----END CERTIFICATE-----`n"
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $want = -join ($sha.ComputeHash($der) | ForEach-Object { $_.ToString('x2') })
        Get-TdCertSha256 -Pem $pem | Should -Be $want
        { Get-TdCertSha256 -Pem 'not a certificate' } | Should -Throw
    }
    It 'writes an https agent address with the pin for an agent that uses TLS' {
        $e = New-TdPortalEnv -Agent ([pscustomobject]@{ guestKey = 'g-key'; adminKey = 'a-key'; tls = $true; port = 8443 }) -AgentHost '192.168.10.30' -CertSha256 ('AB' * 32)
        $e.guest | Should -Match '(?m)^AGENT_URL=https://192\.168\.10\.30:8443/api/v1$'
        $e.admin | Should -Match ('(?m)^AGENT_CERT_SHA256=' + ('ab' * 32) + '$')
    }
}

Describe 'Env files' {
    It 'builds guest, admin and streaming env files from agent.json' {
        $e = New-TdPortalEnv -Agent ([pscustomobject]@{ guestKey = 'g-key'; adminKey = 'a-key'; tls = $false }) -AgentHost '192.168.10.10' -GuacSecret ('ab' * 16) -SessionSecret ('s' * 40)
        $e.guest | Should -Match "(?m)^PORTAL_MODE=guest$"
        $e.guest | Should -Match "(?m)^AGENT_URL=http://192\.168\.10\.10:8080/api/v1$"
        $e.guest | Should -Match "(?m)^AGENT_KEY=g-key$"
        $e.guest | Should -Not -Match 'a-key'
        $e.admin | Should -Match "(?m)^AGENT_KEY=a-key$"
        $e.admin | Should -Match "(?m)^SESSION_SECRET=s{40}$"
        $e.admin | Should -Match "(?m)^GUAC_JSON_SECRET_KEY=(ab){16}$"
        $e.streaming | Should -Match "(?m)^JSON_SECRET_KEY=(ab){16}$"
    }
    It 'requires a pin for an HTTPS agent' {
        { New-TdPortalEnv -Agent @{ guestKey = 'g'; adminKey = 'a'; tls = $true } -AgentHost 'dc' } | Should -Throw
        (New-TdPortalEnv -Agent @{ guestKey = 'g'; adminKey = 'a'; tls = $true } -AgentHost 'dc' -CertSha256 ('A' * 64)).guest | Should -Match 'https://dc:8443/api/v1'
    }
    It 'quotes values with spaces and rejects line breaks' {
        ConvertTo-TdEnvFile -Values ([ordered]@{ A = 'x y'; B = 'p$q' }) | Should -BeExactly "A=`"x y`"`nB=`"p\`$q`"`n"
        { ConvertTo-TdEnvFile -Values @{ A = "x`ny" } } | Should -Throw
    }
    It 'builds samba/.env and validates the form' {
        $t = New-TdSambaEnv -Lite ([pscustomobject]@{ realm = 'Lab.Example.org'; netbios = 'lab'; dcIp = '192.168.1.20'; gateway = '192.168.1.1'; subnet = '192.168.1.0/24'; parentInterface = 'eth0'; dnsForwarder = '' })
        $t | Should -Match '(?m)^REALM=LAB\.EXAMPLE\.ORG$'
        $t | Should -Match '(?m)^DOMAIN_FQDN=lab\.example\.org$'
        $t | Should -Match '(?m)^LAN_IP_RANGE=192\.168\.1\.20/32$'
        $t | Should -Match '(?m)^DNS_FORWARDER=1\.1\.1\.1$'
        $t | Should -Not -Match 'PASSWORD='
        { New-TdSambaEnv -Lite ([pscustomobject]@{ realm = 'x'; netbios = 'L'; dcIp = '1.1.1.1'; gateway = '1.1.1.1'; subnet = '1.1.1.0/24'; parentInterface = 'eth0' }) } | Should -Throw
    }
}

Describe 'Remoting helpers' {
    It 'appends to TrustedHosts without duplicates' {
        Get-TdTrustedHostValue -Current '' -Address '10.0.0.5' | Should -Be '10.0.0.5'
        Get-TdTrustedHostValue -Current 'a, b' -Address '10.0.0.5' | Should -Be 'a,b,10.0.0.5'
        Get-TdTrustedHostValue -Current 'a,10.0.0.5' -Address '10.0.0.5' | Should -BeNullOrEmpty
        Get-TdTrustedHostValue -Current '*' -Address '10.0.0.5' | Should -BeNullOrEmpty
    }
    It 'maps setup-status.json to stage states' {
        $st = [pscustomobject]@{ stage = 'domain'; state = 'running'; message = 'm'; history = @([pscustomobject]@{ stage = 'copy' }, [pscustomobject]@{ stage = 'forest' }) }
        $v = ConvertTo-TdStageView -Status $st
        $v.Stages.copy | Should -Be 'done'; $v.Stages.adws | Should -Be 'done'; $v.Stages.domain | Should -Be 'running'; $v.Stages.agent | Should -Be 'pending'
        @($v.Stages.Keys) | Should -Not -Contain 'portals'
        (ConvertTo-TdStageView -Status ([pscustomobject]@{ stage = 'ready'; state = 'ready'; message = ''; history = @() }) -NativePortals $true).Stages.portals | Should -Be 'done'
        (ConvertTo-TdStageView -Status ([pscustomobject]@{ stage = 'continue'; state = 'failed'; message = 'x'; history = @([pscustomobject]@{ stage = 'adws' }) })).Failed | Should -BeTrue
    }
    It 'quotes shell arguments for the remote side' {
        ConvertTo-TdShellQuote "it's" | Should -BeExactly "'it'\''s'"
        ConvertTo-TdWindowsArg 'plain' | Should -BeExactly 'plain'
        ConvertTo-TdWindowsArg 'a b' | Should -BeExactly '"a b"'
        ConvertTo-TdWindowsArg 'say "hi"' | Should -BeExactly '"say \"hi\""'
        ConvertTo-TdWindowsArg 'C:\dir with space\' | Should -BeExactly '"C:\dir with space\\"'
        ConvertTo-TdWindowsArg '' | Should -BeExactly '""'
        Test-TdSshTarget -User 'ubuntu' -HostName '192.168.1.5' | Should -BeTrue
        Test-TdSshTarget -User 'bad user' -HostName 'h' | Should -BeFalse
        (Get-TdSshArgs ([pscustomobject]@{ user = 'u'; host = 'h'; port = 2222 })) -join ' ' | Should -Match 'BatchMode=yes.*-p 2222'
    }
}

Describe 'Personal wording validator' {
    It 'accepts a neutral file' {
        $r = Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{"computer":"machine","private vocabulary":"Wording applied"}}'
        $r.Ok | Should -BeTrue; $r.Entries['computer'] | Should -Be 'machine'
    }
    It 'rejects duplicate keys at any level' {
        (Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{"a":"b","a":"c"}}').Error | Should -Be 'duplicate'
        (Test-TdVocabulary -Text '{"schemaVersion":1,"schemaVersion":1,"entries":{}}').Error | Should -Be 'duplicate'
    }
    It 'rejects the forbidden keys, long keys and values, and control characters' {
        (Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{"__proto__":"x"}}').Error | Should -Be 'keyForbidden'
        (Test-TdVocabulary -Text ('{"schemaVersion":1,"entries":{"' + ('k' * 161) + '":"x"}}')).Error | Should -Be 'keyLength'
        (Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{"":"x"}}').Error | Should -Be 'keyLength'
        (Test-TdVocabulary -Text ('{"schemaVersion":1,"entries":{"k":"' + ('v' * 1001) + '"}}')).Error | Should -Be 'valueLength'
        (Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{"k":"a\u0007b"}}').Error | Should -Be 'valueControl'
        (Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{"k":1}}').Error | Should -Be 'valueType'
    }
    It 'rejects depth over 8, wrong version, extra keys, bad syntax, size and encoding' {
        (Test-TdVocabulary -Text ('{"schemaVersion":1,"entries":{},"x":' + ('[' * 8) + (']' * 8) + '}')).Error | Should -Be 'depth'
        (Test-TdVocabulary -Text '{"schemaVersion":2,"entries":{}}').Error | Should -Be 'version'
        (Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{},"more":1}').Error | Should -Be 'schema'
        (Test-TdVocabulary -Text '{"schemaVersion":1,"entries":{"a":"b",}}').Error | Should -Be 'syntax'
        (Test-TdVocabulary -Bytes ([byte[]](@(0x7B) * 262145))).Error | Should -Be 'tooLarge'
        (Test-TdVocabulary -Bytes ([byte[]](0x7B, 0xC3, 0x28, 0x7D))).Error | Should -Be 'encoding'
    }
}

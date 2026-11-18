$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$catalogRepository = 'Ding-Ding-Projects/dim-sum-photos'
$catalogUrl = "https://github.com/$catalogRepository/blob/main/catalog/index.json"
$historyRoute = "repos/$env:GITHUB_REPOSITORY/releases?per_page=100"
$used = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$history = gh api --paginate $historyRoute --jq '.[].body // empty'
foreach ($match in [regex]::Matches(($history -join ' '), '(?i)<!-- dim-sum-code-name: (hk-dish-\d+) -->')) {
    $null = $used.Add($match.Groups[1].Value)
}

$catalog = gh api "repos/$catalogRepository/contents/catalog/index.json?ref=main" -H 'Accept: application/vnd.github.raw+json' | ConvertFrom-Json
$catalogReleases = "repos/$catalogRepository/releases?per_page=100"
$releasedPhotos = @{}
gh api --paginate $catalogReleases --jq '.[] | select((.draft or .prerelease) | not) | select(.tag_name | startswith("catalog-v1")) | .assets[] | select(.state == "uploaded" and .size > 0) | [.name, .browser_download_url] | @tsv' |
    ForEach-Object {
        $name, $url = $_ -split '\s+'
        if ($url -cmatch '^https://github\.com/Ding-Ding-Projects/dim-sum-photos/releases/download/catalog-v1[\w.-]*/[\w.-]+\.png$') {
            $releasedPhotos[$name] = $url
        }
    }
foreach ($dish in $catalog.dishes) {
    if ($dish.id -cnotmatch '^hk-dish-\d+$' -or $used.Contains($dish.id) -or !$dish.image.path) { continue }
    $name = [IO.Path]::GetFileName($dish.image.path)
    if (!$releasedPhotos.ContainsKey($name) -or !$dish.name.en -or !$dish.name.zhHant) { continue }
    [pscustomobject]@{ id = $dish.id; english = $dish.name.en; traditionalChinese = $dish.name.zhHant; photo = $releasedPhotos[$name]; catalog = $catalogUrl }
    return
}

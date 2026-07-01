export interface SelectedRepo { owner: string; repo: string; fullName: string; }

let _selected: SelectedRepo | null = null;

export function getSelectedRepo(): SelectedRepo | null { return _selected; }
export function setSelectedRepo(r: SelectedRepo | null): void { _selected = r; }

export async function fetchUserRepos(token: string): Promise<SelectedRepo[]> {
  try {
    const res = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator",
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) { return []; }
    const data = await res.json() as any[];
    return data.map(r => ({ owner: r.owner.login, repo: r.name, fullName: r.full_name }));
  } catch {
    return [];
  }
}

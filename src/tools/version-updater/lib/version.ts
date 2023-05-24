export enum VersionPart {
    Major = 1,
    Minor,
    Patch
}

type VersionValue = {
    major: number,
    minor: number,
    patch: number,
}

export class Version {
    public major: number = 0;
    public minor: number = 0;
    public patch: number = 0;

    public constructor(tag: string) {
        const regex = new RegExp(`^[^\\d]*(\\d*)\\.(\\d*)\\.(\\d*)$`, 'gm')

        let m;

        while ((m = regex.exec(tag)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === regex.lastIndex) {
                regex.lastIndex++;
            }

            m.forEach((match, groupIndex) => {
                switch (groupIndex) {
                    case VersionPart.Major:
                        this.major = parseInt(match);
                        break;
                    case VersionPart.Minor:
                        this.minor = parseInt(match);
                        break;
                    case VersionPart.Patch:
                        this.patch = parseInt(match);
                        break;
                }
            });
        }
    }

    public getTag(prefix = ''): string {
        return `${prefix}${this.major}.${this.minor}.${this.patch}`;
    }

    public getVersion(): VersionValue {
        const result: VersionValue = {
            major: this.major,
            minor: this.minor,
            patch: this.patch
        };

        return result;
    }

    public raise(part: VersionPart): Version {
        const result = new Version(this.getTag());
        switch (part) {
            case VersionPart.Major:
                result.major++;
                result.minor = 0;
                result.patch = 0;
                break;
            case VersionPart.Minor:
                result.minor++;
                result.patch = 0;
                break;
            case VersionPart.Patch:
                result.patch++;
                break;
        }
        return result;
    }
}

export function getPrefix(version: string): string {
    const regex = new RegExp('^([^\\d]*)(\\d+\\.\\d+\\.\\d+)$', 'mg')
    const m = regex.exec(version);
    if (m !== null) {
        return m[1];
    }
    return '';
}

function getVersion(version: string): string {
    const regex = new RegExp('^([^\\d]*)(\\d+\\.\\d+\\.\\d+)$', 'mg')
    const m = regex.exec(version);
    if (m !== null) {
        return m[2];
    }
    return '';
}

export function equalVersions(versionA: string, versionB: string): boolean {
    return getVersion(versionA) === getVersion(versionB);
}

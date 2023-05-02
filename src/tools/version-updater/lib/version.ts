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
        const regex = new RegExp('^v(\\d*)\\.(\\d*)\\.(\\d*)$', 'gm')

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

    public getTag(): string {
        return `v${this.major}.${this.minor}.${this.patch}`;
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
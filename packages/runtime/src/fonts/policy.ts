let remoteWebFontsEnabled = true;

export function setRemoteWebFontsEnabled(enabled: boolean): void {
	remoteWebFontsEnabled = enabled;
}

export function canLoadRemoteWebFonts(): boolean {
	return remoteWebFontsEnabled;
}

export function resolveWebFontSource(family: string, remoteUrl: string): string {
	return remoteWebFontsEnabled ? `url(${remoteUrl})` : `local('${family}')`;
}

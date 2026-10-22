export {};
declare global {
    interface Window {
        invyrixDesktop?: { linkInstitute: (id: string, slug: string) => Promise<void> };
    }
}

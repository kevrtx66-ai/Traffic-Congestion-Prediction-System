(async function bootstrapLegacyEntrypoint() {
	try {
		await import('/static/js/main.js');
	} catch (error) {
		console.error('Failed to load modern app entrypoint:', error);
	}
})();

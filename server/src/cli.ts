const [command] = process.argv.slice(2);
console.error(`Perintah tidak dikenal: ${command ?? '(kosong)'}`);
process.exit(1);

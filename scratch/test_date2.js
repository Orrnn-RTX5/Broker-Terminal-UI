try {
    const d = new Date(1774502954768000).toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    console.log(d);
} catch (e) {
    console.log("Error:", e.message);
}

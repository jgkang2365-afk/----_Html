async function triggerApi() {
    const payload = {
        name: "trigger_test_" + Date.now(),
        role: "사용자",
        job: "측정",
        password: "password123",
        survey_code: "T1"
    };

    console.log("Triggering POST /api/users...");
    try {
        const response = await fetch("http://localhost:3000/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log("Response Status:", response.status);
        console.log("Response Body:", text);
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

triggerApi();

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDistribution() {
    const targetManagers = ['한기문', '이주형', '강종구', '고유빈'];
    const { data, error } = await supabase
        .from("measurement_target_business")
        .select("year, period")
        .in("plan_manager", targetManagers);

    if (error) {
        console.log("ERROR:", error);
        return;
    }

    const distribution: Record<string, number> = {};
    data.forEach(item => {
        const key = `${item.year}-${item.period}`;
        distribution[key] = (distribution[key] || 0) + 1;
    });

    console.log("DISTRIBUTION_START");
    console.log(JSON.stringify(distribution, null, 2));
    console.log("DISTRIBUTION_END");
}

checkDistribution();

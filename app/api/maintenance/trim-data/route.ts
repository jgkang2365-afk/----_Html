import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
    const supabase = await createClient();

    try {
        // 1. measurement_period Trim (SQL query execution via rpc is ideal but direct execution is not available)
        // Instead we fetch rows where length matches but is not equal to trimmed (or just fetch all and check)
        // Actually Supabase JS client doesn't support generic SQL update 'set x = trim(x)'.
        // We have to iterate or use specific rpc if available.
        // Given the constraints and likely small dataset, we will iterate.

        // Fetch all IDs where potential whitespace exists.
        // ' ' is generic space.
        // Just fetch all for simplicity to be sure. (Or create a specific filter if possible)

        const { data: allJournals, error } = await supabase
            .from('measurement_journal')
            .select('id, measurement_period, designated_office, office_jurisdiction');

        if (error) throw error;

        let updatedCount = 0;
        const updates = [];

        for (const journal of allJournals) {
            let needsUpdate = false;
            const updateData: any = {};

            if (journal.measurement_period && journal.measurement_period !== journal.measurement_period.trim()) {
                updateData.measurement_period = journal.measurement_period.trim();
                needsUpdate = true;
            }

            if (journal.designated_office && journal.designated_office !== journal.designated_office.trim()) {
                updateData.designated_office = journal.designated_office.trim();
                needsUpdate = true;
            }

            if (journal.office_jurisdiction && journal.office_jurisdiction !== journal.office_jurisdiction.trim()) {
                updateData.office_jurisdiction = journal.office_jurisdiction.trim();
                needsUpdate = true;
            }

            if (needsUpdate) {
                updates.push(
                    supabase.from('measurement_journal').update(updateData).eq('id', journal.id)
                );
                updatedCount++;
            }
        }

        // Execute updates in parallel batches
        await Promise.all(updates);

        return NextResponse.json({
            success: true,
            message: `Updated ${updatedCount} records to remove whitespace.`,
            updatedCount
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

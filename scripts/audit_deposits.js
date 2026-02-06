
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function auditDeposits() {
    console.log('Starting Deposit Audit...');

    // Fetch relevant columns for all journals (focusing on 2025-2026 to be safe, or all)
    const { data: journals, error } = await supabase
        .from('measurement_journal')
        .select('id, measurement_year, measurement_period, business_name, measurement_fee_total, measurement_fee_business, measurement_fee_national, deposit_total, deposit_amount_business, deposit_amount_business_2, deposit_amount_national, created_at')
        .order('measurement_year', { ascending: false });

    if (error) {
        console.error('Error fetching journals:', error);
        return;
    }

    const anomalies = [];

    journals.forEach(j => {
        const feeNational = Number(j.measurement_fee_national || 0);
        const depositNational = Number(j.deposit_amount_national || 0);
        const feeTotal = Number(j.measurement_fee_total || 0);
        const depositTotal = Number(j.deposit_total || 0);

        const issues = [];

        // Check 1: Ghost National Deposit (Fee is 0, but Deposit exists)
        if (feeNational === 0 && depositNational > 0) {
            issues.push(`Ghost National Deposit: Fee=0, Deposit=${depositNational.toLocaleString()}`);
        }

        // Check 2: Negative Unpaid (Deposit > Fee) - Ignoring small floating point diffs if any, but these are integers mostly
        if (depositTotal > feeTotal) {
            const diff = feeTotal - depositTotal;
            issues.push(`Over-Deposit (Negative Unpaid): Fee=${feeTotal.toLocaleString()}, Deposit=${depositTotal.toLocaleString()}, Diff=${diff.toLocaleString()}`);
        }

        if (issues.length > 0) {
            anomalies.push({
                id: j.id,
                year: j.measurement_year,
                period: j.measurement_period,
                business: j.business_name,
                issues: issues
            });
        }
    });

    if (anomalies.length === 0) {
        console.log('No anomalies found.');
    } else {
        console.log(`Found ${anomalies.length} anomalies:\n`);
        anomalies.forEach(a => {
            console.log(`[ID: ${a.id}] ${a.year} ${a.period} - ${a.business}`);
            a.issues.forEach(i => console.log(`  - ${i}`));
            console.log('');
        });
    }
}

auditDeposits();

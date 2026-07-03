import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUsers() {
    console.log("Supabase URL:", supabaseUrl);
    const { data: users, error } = await supabase
        .from('users')
        .select('id, name, role, is_active, password_hash, created_at, updated_at')
        .order('name');

    if (error) {
        console.error("Error fetching users:", error);
        return;
    }

    console.log("--- Users List ---");
    users?.forEach(u => {
        console.log(`ID: ${u.id} | Name: ${u.name} | Role: ${u.role} | Active: ${u.is_active} | Has Hash: ${!!u.password_hash} | Updated: ${u.updated_at}`);
    });
    console.log("-------------------");
}

checkUsers();

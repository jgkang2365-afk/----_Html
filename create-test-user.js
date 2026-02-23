
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTestUser() {
    const name = "testadmin";
    const password = "testpassword";
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const { data, error } = await supabase
        .from('users')
        .insert({
            name: name,
            password_hash: hash,
            role: '관리자',
            job: '측정'
        })
        .select();

    if (error) {
        if (error.code === '23505') { // Unique violation
            console.log("User already exists, updating password...");
            const { error: updateError } = await supabase
                .from('users')
                .update({ password_hash: hash })
                .eq('name', name);
            if (updateError) console.error(updateError);
            else console.log("Password updated successfully.");
        } else {
            console.error(error);
        }
    } else {
        console.log(`Test user created: ${name} / ${password}`);
    }
}

createTestUser();

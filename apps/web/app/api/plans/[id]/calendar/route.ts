import { addPlanToCalendar, planRoute } from '@hacktx/integrations/calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = planRoute(addPlanToCalendar);

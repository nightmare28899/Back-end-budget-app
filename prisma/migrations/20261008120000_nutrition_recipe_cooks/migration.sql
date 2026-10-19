-- CreateTable
CREATE TABLE "nutrition_recipe_cooks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "recipe_id" UUID NOT NULL,
    "cooked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_recipe_cooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nutrition_recipe_cooks_owner_id_recipe_id_cooked_at_idx" ON "nutrition_recipe_cooks"("owner_id", "recipe_id", "cooked_at" DESC);

-- AddForeignKey
ALTER TABLE "nutrition_recipe_cooks" ADD CONSTRAINT "nutrition_recipe_cooks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "nutrition_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recipe_cooks" ADD CONSTRAINT "nutrition_recipe_cooks_owner_id_recipe_id_fkey" FOREIGN KEY ("owner_id", "recipe_id") REFERENCES "nutrition_recipes"("owner_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Functions: bodies copied from 20261002120000_nutrition (no later migration
-- redefines them). nutrition_state adds cookCount/lastCookedAt per recipe and
-- nutrition_command adds cook_recipe / undo_cook_recipe.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION nutrition_state(owner_id_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb; uid text:=owner_id_arg; initial_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT nullif(btrim(left(u.name,100)),'') INTO initial_name FROM public.users u WHERE u.id=uid;
  initial_name:=coalesce(initial_name,'You');
  WHILE public.nutrition_text_length(initial_name)>100 LOOP initial_name:=left(initial_name,char_length(initial_name)-1); END LOOP;
  INSERT INTO public.nutrition_users(id,name) VALUES(uid,initial_name) ON CONFLICT(id) DO NOTHING;
  SELECT jsonb_build_object('profile', (SELECT jsonb_build_object('id',id,'name',name,'timezone',timezone,'times',times,'theme',theme) FROM public.nutrition_users WHERE id=uid),
  'diets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'startDate',d.start_date,'endDate',d.end_date,'status',d.status,'active',d.active,
  'meals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,'options',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'notes',o.notes,'recipeId',o.recipe_id,'portions',public.nutrition_portions(uid,o.id,NULL)) ORDER BY o.position) FROM public.nutrition_diet_meal_options o WHERE o.meal_id=m.id AND o.owner_id=uid),'[]')) ORDER BY array_position(ARRAY['breakfast','morning_snack','lunch','afternoon_snack','dinner'],m.type)) FROM public.nutrition_diet_meals m WHERE m.diet_id=d.id AND m.owner_id=uid),'[]')) ORDER BY d.created_at DESC) FROM public.nutrition_diets d WHERE d.owner_id=uid),'[]'),
  'recipes',coalesce((SELECT jsonb_agg(public.nutrition_recipe_json(uid,r.id) || jsonb_build_object('cookCount',(SELECT count(*)::integer FROM public.nutrition_recipe_cooks c WHERE c.recipe_id=r.id AND c.owner_id=uid),'lastCookedAt',(SELECT max(c.cooked_at) FROM public.nutrition_recipe_cooks c WHERE c.recipe_id=r.id AND c.owner_id=uid)) ORDER BY r.created_at DESC) FROM public.nutrition_recipes r WHERE r.owner_id=uid),'[]'),
  'plans',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'date',p.date,'timezone',p.timezone,'dietId',p.diet_id,'meals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,'time',m.time,'snapshot',m.snapshot,'status',m.status,'completedAt',(SELECT completed_at FROM public.nutrition_meal_completions WHERE meal_id=m.id AND owner_id=uid)) ORDER BY array_position(ARRAY['breakfast','morning_snack','lunch','afternoon_snack','dinner'],m.type)) FROM public.nutrition_daily_meals m WHERE m.plan_id=p.id AND m.owner_id=uid),'[]'))) FROM public.nutrition_daily_plans p WHERE p.owner_id=uid),'[]'),
  'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'dietId',diet_id,'name',name,'mime',mime,'size',size,'createdAt',created_at)) FROM public.nutrition_diet_original_files WHERE owner_id=uid),'[]')) INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION nutrition_command(owner_id_arg text, command text, payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE uid text:=owner_id_arg; item_id uuid; meal jsonb; opt jsonb; step text; pos integer; recipe jsonb; d public.nutrition_diets; m public.nutrition_daily_meals; generated_plan_id uuid; current_day date; p public.nutrition_users; selected_option public.nutrition_diet_meal_options; recipe_id_arg uuid; diet_id_arg uuid;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF command IS NULL OR command NOT IN ('save_diet','verify_diet','activate_diet','save_recipe','delete_recipe','favorite','cook_recipe','undo_cook_recipe','settings','generate_plan','completion','choose_recipe','original_file') THEN RAISE EXCEPTION 'Unsupported operation'; END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>1048576 THEN RAISE EXCEPTION 'Invalid bounded payload'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 PERFORM public.nutrition_state(uid);
 IF command NOT IN ('generate_plan','settings') THEN item_id:=public.nutrition_uuid(payload->'id'); END IF;
 IF command='save_diet' THEN
   PERFORM public.nutrition_text(payload->'title',120);
   IF jsonb_typeof(payload->'meals') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Five unique meal types required'; END IF;
   IF jsonb_array_length(payload->'meals')<>5 OR (SELECT count(DISTINCT x->>'type') FROM jsonb_array_elements(payload->'meals') x)<>5 THEN RAISE EXCEPTION 'Five unique meal types required'; END IF;
   IF coalesce(payload->>'status','') NOT IN ('draft','pending_verification') THEN RAISE EXCEPTION 'Save a draft before verification'; END IF;
   IF public.nutrition_text(payload->'startDate',10) !~ '^\d{4}-\d{2}-\d{2}$' OR payload->'endDate' IS NULL OR (payload->'endDate'<>'null'::jsonb AND public.nutrition_text(payload->'endDate',10) !~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'Invalid diet dates'; END IF;
   INSERT INTO public.nutrition_diets(id,owner_id,title,start_date,end_date,status,active) VALUES(item_id,uid,payload->>'title',(payload->>'startDate')::date,(payload->>'endDate')::date,'draft',false)
   ON CONFLICT(id) DO UPDATE SET title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,status='draft',active=false,updated_at=now() WHERE nutrition_diets.owner_id=uid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Diet unavailable'; END IF;
   DELETE FROM public.nutrition_diet_meals WHERE diet_id=item_id AND owner_id=uid;
   FOR meal IN SELECT value FROM jsonb_array_elements(payload->'meals') LOOP
    IF jsonb_typeof(meal->'options') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid meal options'; END IF;
    IF jsonb_array_length(meal->'options')>12 THEN RAISE EXCEPTION 'Too many meal options'; END IF;
    INSERT INTO public.nutrition_diet_meals(id,owner_id,diet_id,type) VALUES(public.nutrition_uuid(meal->'id'),uid,item_id,public.nutrition_text(meal->'type',30)); pos:=0;
    FOR opt IN SELECT value FROM jsonb_array_elements(meal->'options') LOOP
     PERFORM public.nutrition_validate_portions(opt->'portions',false);
     IF opt->'recipeId' IS NULL THEN RAISE EXCEPTION 'Invalid recipe association'; END IF;
     recipe_id_arg:=CASE WHEN opt->'recipeId'='null'::jsonb THEN NULL ELSE public.nutrition_uuid(opt->'recipeId') END;
     IF recipe_id_arg IS NOT NULL AND NOT public.nutrition_recipe_matches(uid,recipe_id_arg,opt->'portions',meal->>'type') THEN RAISE EXCEPTION 'Recipe must match exact prescribed portions and preparation'; END IF;
     INSERT INTO public.nutrition_diet_meal_options(id,owner_id,meal_id,title,notes,position,recipe_id) VALUES(public.nutrition_uuid(opt->'id'),uid,(meal->>'id')::uuid,public.nutrition_text(opt->'title',120),public.nutrition_text(opt->'notes',2000,true),pos,recipe_id_arg);
     PERFORM public.nutrition_insert_portions(uid,opt->'portions',(opt->>'id')::uuid,NULL); pos:=pos+1;
   END LOOP;
  END LOOP;
 ELSIF command IN ('verify_diet','activate_diet') THEN
   IF command='verify_diet' AND payload->'acknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Confirm the manual transcription first'; END IF;
   SELECT * INTO d FROM public.nutrition_diets WHERE id=item_id AND owner_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Diet unavailable'; END IF;
   IF (SELECT count(*) FROM public.nutrition_diet_meals WHERE diet_id=item_id AND owner_id=uid)<>5 THEN RAISE EXCEPTION 'Five meals required'; END IF;
   FOR meal IN SELECT to_jsonb(x) FROM public.nutrition_diet_meals x WHERE diet_id=item_id AND owner_id=uid LOOP
    IF NOT EXISTS(SELECT 1 FROM public.nutrition_diet_meal_options WHERE meal_id=(meal->>'id')::uuid AND owner_id=uid) THEN RAISE EXCEPTION 'Each meal needs an option'; END IF;
    FOR selected_option IN SELECT * FROM public.nutrition_diet_meal_options WHERE meal_id=(meal->>'id')::uuid AND owner_id=uid LOOP
     PERFORM public.nutrition_validate_portions(public.nutrition_portions(uid,selected_option.id,NULL),true);
     IF selected_option.recipe_id IS NOT NULL AND NOT public.nutrition_recipe_matches(uid,selected_option.recipe_id,public.nutrition_portions(uid,selected_option.id,NULL),meal->>'type') THEN RAISE EXCEPTION 'Associated recipe no longer matches'; END IF;
   END LOOP;
  END LOOP;
  IF command='activate_diet' AND d.status<>'verified' THEN RAISE EXCEPTION 'Verify transcription before activation'; END IF;
   IF command='activate_diet' THEN UPDATE public.nutrition_diets SET active=false WHERE owner_id=uid AND active; END IF;
   UPDATE public.nutrition_diets SET status='verified',active=(command='activate_diet'),updated_at=now() WHERE id=item_id AND owner_id=uid;
  ELSIF command='save_recipe' THEN
   PERFORM public.nutrition_text(payload->'title',120);
   PERFORM public.nutrition_text(payload->'notes',3000,true);
   IF jsonb_typeof(payload->'demo') IS DISTINCT FROM 'boolean' OR jsonb_typeof(payload->'duration') IS DISTINCT FROM 'number' OR payload->>'duration' !~ '^\d{1,4}$' OR (payload->>'duration')::integer>1440 THEN RAISE EXCEPTION 'Invalid recipe metadata'; END IF;
   IF payload->'seedKey' IS NULL OR payload->'imageUrl' IS NULL THEN RAISE EXCEPTION 'Invalid nullable recipe fields'; END IF;
   IF payload->'seedKey'<>'null'::jsonb THEN PERFORM public.nutrition_text(payload->'seedKey',100,true); END IF;
   IF payload->'imageUrl'<>'null'::jsonb THEN
    PERFORM public.nutrition_text(payload->'imageUrl',2048);
    IF payload->>'imageUrl' !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z])?([/?#][^[:space:]]*)?$' THEN RAISE EXCEPTION 'Use an HTTPS image URL with a DNS host'; END IF;
   END IF;
   PERFORM public.nutrition_validate_portions(payload->'ingredients',NOT (payload->>'demo')::boolean);
  FOR opt IN SELECT value FROM jsonb_array_elements(payload->'ingredients') LOOP
    IF (opt->>'free')::boolean AND NOT EXISTS(SELECT 1 FROM public.nutrition_food_portions fp WHERE fp.owner_id=uid AND fp.option_id IS NOT NULL AND fp.free AND fp.food_id=opt->>'foodId' AND fp.unit=opt->>'unit' AND fp.preparation=opt->>'preparation') THEN RAISE EXCEPTION 'Explicit diet allowance required for free food'; END IF;
  END LOOP;
   IF jsonb_typeof(payload->'steps') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Preparation steps required'; END IF;
   IF jsonb_array_length(payload->'steps') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Preparation steps required'; END IF;
   FOR opt IN SELECT value FROM jsonb_array_elements(payload->'steps') LOOP PERFORM public.nutrition_text(opt,2000); END LOOP;
   IF payload->>'seedKey' IS NOT NULL AND EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE owner_id=uid AND seed_key=payload->>'seedKey') THEN RETURN '{}'::jsonb; END IF;
   INSERT INTO public.nutrition_recipes(id,owner_id,title,type,duration,notes,image_url,demo,seed_key) VALUES(item_id,uid,payload->>'title',public.nutrition_text(payload->'type',30),(payload->>'duration')::integer,payload->>'notes',payload->>'imageUrl',(payload->>'demo')::boolean,payload->>'seedKey')
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,type=excluded.type,duration=excluded.duration,notes=excluded.notes,image_url=excluded.image_url,demo=excluded.demo,updated_at=now() WHERE nutrition_recipes.owner_id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe unavailable'; END IF;
   DELETE FROM public.nutrition_food_portions WHERE recipe_id=item_id AND owner_id=uid; DELETE FROM public.nutrition_recipe_steps WHERE recipe_id=item_id AND owner_id=uid;
   PERFORM public.nutrition_insert_portions(uid,payload->'ingredients',NULL,item_id); pos:=0;
   FOR step IN SELECT jsonb_array_elements_text(payload->'steps') LOOP INSERT INTO public.nutrition_recipe_steps(owner_id,recipe_id,position,instruction) VALUES(uid,item_id,pos,step); pos:=pos+1; END LOOP;
   UPDATE public.nutrition_diets SET status='draft',active=false WHERE owner_id=uid AND id IN(SELECT dm.diet_id FROM public.nutrition_diet_meals dm JOIN public.nutrition_diet_meal_options o ON o.meal_id=dm.id AND o.owner_id=uid WHERE dm.owner_id=uid AND o.recipe_id=item_id AND NOT public.nutrition_recipe_matches(uid,item_id,public.nutrition_portions(uid,o.id,NULL),dm.type));
  ELSIF command='delete_recipe' THEN
   IF NOT EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE id=item_id AND owner_id=uid) THEN RAISE EXCEPTION 'Recipe unavailable'; END IF;
   UPDATE public.nutrition_diet_meal_options SET recipe_id=NULL WHERE recipe_id=item_id AND owner_id=uid;
   DELETE FROM public.nutrition_recipes WHERE id=item_id AND owner_id=uid;
  ELSIF command='favorite' THEN
   IF jsonb_typeof(payload->'favorite') IS DISTINCT FROM 'boolean' OR NOT EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE id=item_id AND owner_id=uid) THEN RAISE EXCEPTION 'Favorite recipe unavailable'; END IF;
   IF (payload->>'favorite')::boolean THEN INSERT INTO public.nutrition_favorite_recipes(owner_id,recipe_id) VALUES(uid,item_id) ON CONFLICT(owner_id,recipe_id) DO NOTHING;
   ELSE DELETE FROM public.nutrition_favorite_recipes WHERE owner_id=uid AND recipe_id=item_id; END IF;
  ELSIF command IN ('cook_recipe','undo_cook_recipe') THEN
   IF NOT EXISTS(SELECT 1 FROM public.nutrition_recipes WHERE id=item_id AND owner_id=uid) THEN RAISE EXCEPTION 'Cooked recipe unavailable'; END IF;
   IF command='cook_recipe' THEN INSERT INTO public.nutrition_recipe_cooks(owner_id,recipe_id) VALUES(uid,item_id);
   ELSE DELETE FROM public.nutrition_recipe_cooks WHERE id=(SELECT c.id FROM public.nutrition_recipe_cooks c WHERE c.owner_id=uid AND c.recipe_id=item_id ORDER BY c.cooked_at DESC, c.id DESC LIMIT 1); END IF;
  ELSIF command='settings' THEN
   IF payload->>'id' IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Profile unavailable'; END IF;
   PERFORM public.nutrition_text(payload->'name',100);
   IF coalesce(payload->>'theme','') NOT IN ('light','dark') OR payload->>'timezone' IN ('Factory','localtime') OR payload->>'timezone' ~ '^(posix|right)/' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=payload->>'timezone') THEN RAISE EXCEPTION 'Invalid profile settings'; END IF;
   IF jsonb_typeof(payload->'times') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Five meal times required'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(payload->'times'))<>5 THEN RAISE EXCEPTION 'Five meal times required'; END IF;
  FOR step IN SELECT unnest(ARRAY['breakfast','morning_snack','lunch','afternoon_snack','dinner']) LOOP IF coalesce(payload->'times'->>step,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid meal time'; END IF; END LOOP;
   UPDATE public.nutrition_users SET name=payload->>'name',timezone=payload->>'timezone',times=payload->'times',theme=payload->>'theme',updated_at=now() WHERE id=uid;
 ELSIF command='generate_plan' THEN
   SELECT * INTO p FROM public.nutrition_users WHERE id=uid;
  current_day:=(now() AT TIME ZONE p.timezone)::date;
   IF EXISTS(SELECT 1 FROM public.nutrition_daily_plans WHERE owner_id=uid AND date=current_day) THEN RETURN '{}'::jsonb; END IF;
   SELECT * INTO d FROM public.nutrition_diets WHERE owner_id=uid AND active AND status='verified' AND start_date<=current_day AND (end_date IS NULL OR end_date>=current_day);
  IF NOT FOUND THEN RAISE EXCEPTION 'Activate a verified diet covering today first'; END IF;
   generated_plan_id:=gen_random_uuid(); INSERT INTO public.nutrition_daily_plans(id,owner_id,diet_id,date,timezone) VALUES(generated_plan_id,uid,d.id,current_day,p.timezone);
   FOR meal IN SELECT to_jsonb(x) FROM public.nutrition_diet_meals x WHERE diet_id=d.id AND owner_id=uid LOOP
    SELECT * INTO selected_option FROM public.nutrition_diet_meal_options WHERE meal_id=(meal->>'id')::uuid AND owner_id=uid ORDER BY position LIMIT 1;
   IF NOT FOUND THEN RAISE EXCEPTION 'Verified meal option required'; END IF;
    PERFORM public.nutrition_validate_portions(public.nutrition_portions(uid,selected_option.id,NULL),true);
    recipe:=public.nutrition_recipe_json(uid,selected_option.recipe_id);
    IF selected_option.recipe_id IS NOT NULL AND NOT public.nutrition_recipe_matches(uid,selected_option.recipe_id,public.nutrition_portions(uid,selected_option.id,NULL),meal->>'type') THEN RAISE EXCEPTION 'Recipe no longer matches'; END IF;
    INSERT INTO public.nutrition_daily_meals(owner_id,plan_id,type,time,snapshot) VALUES(uid,generated_plan_id,meal->>'type',p.times->>(meal->>'type'),jsonb_build_object('title',coalesce(recipe->>'title',selected_option.title),'optionId',selected_option.id,'recipeId',selected_option.recipe_id,'ingredients',public.nutrition_portions(uid,selected_option.id,NULL),'steps',coalesce(recipe->'steps','[]'::jsonb),'notes',selected_option.notes));
  END LOOP;
   IF (SELECT count(*) FROM public.nutrition_daily_meals WHERE plan_id=generated_plan_id AND owner_id=uid)<>5 THEN RAISE EXCEPTION 'Five daily meals required'; END IF;
 ELSIF command IN ('completion','choose_recipe') THEN
   SELECT * INTO m FROM public.nutrition_daily_meals WHERE id=item_id AND owner_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meal unavailable'; END IF;
  IF command='completion' THEN
    IF coalesce(payload->>'status','') NOT IN ('pending','completed','skipped') THEN RAISE EXCEPTION 'Invalid status'; END IF;
    UPDATE public.nutrition_daily_meals SET status=payload->>'status',updated_at=now() WHERE id=item_id AND owner_id=uid;
    IF payload->>'status'='completed' THEN INSERT INTO public.nutrition_meal_completions(owner_id,meal_id) VALUES(uid,item_id) ON CONFLICT(meal_id) DO NOTHING;
    ELSE DELETE FROM public.nutrition_meal_completions WHERE owner_id=uid AND meal_id=item_id; END IF;
  ELSE
    recipe_id_arg:=public.nutrition_uuid(payload->'recipeId');
    IF m.status<>'pending' OR NOT public.nutrition_recipe_matches(uid,recipe_id_arg,m.snapshot->'ingredients',m.type) THEN RAISE EXCEPTION 'Choose a matching recipe for a pending meal'; END IF;
    recipe:=public.nutrition_recipe_json(uid,recipe_id_arg);
    UPDATE public.nutrition_daily_meals SET snapshot=snapshot || jsonb_build_object('recipeId',recipe->'id','title',recipe->'title','steps',recipe->'steps') WHERE id=item_id AND owner_id=uid;
  END IF;
 ELSIF command='original_file' THEN
   diet_id_arg:=public.nutrition_uuid(payload->'dietId');
   IF NOT EXISTS(SELECT 1 FROM public.nutrition_diets WHERE id=diet_id_arg AND owner_id=uid) THEN RAISE EXCEPTION 'Diet unavailable'; END IF;
   PERFORM public.nutrition_text(payload->'name',200);
   IF coalesce(payload->>'path','') <> 'nutrition/'||uid||'/'||item_id::text THEN RAISE EXCEPTION 'Retained private object required'; END IF;
   IF coalesce(payload->>'mime','') NOT IN ('image/jpeg','image/png','application/pdf') OR coalesce(payload->>'hash','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(payload->'size') IS DISTINCT FROM 'number' OR payload->>'size' !~ '^\d{1,7}$' THEN RAISE EXCEPTION 'Invalid original metadata'; END IF;
   INSERT INTO public.nutrition_diet_original_files(id,owner_id,diet_id,path,name,mime,size,hash) VALUES(item_id,uid,diet_id_arg,payload->>'path',payload->>'name',payload->>'mime',(payload->>'size')::integer,payload->>'hash');
   UPDATE public.nutrition_diets SET status='pending_verification',active=false WHERE owner_id=uid AND id=diet_id_arg;
 ELSE RAISE EXCEPTION 'Unsupported operation'; END IF;
 RETURN '{}'::jsonb;
END $$;


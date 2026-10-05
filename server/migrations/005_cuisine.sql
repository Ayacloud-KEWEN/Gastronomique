-- 新增分类「菜系」（cuisine），从「菜品」中独立出来
ALTER TABLE items DROP CONSTRAINT items_type_check;
ALTER TABLE items ADD CONSTRAINT items_type_check
  CHECK (type IN ('ingredient','dish','cuisine','beverage','restaurant','producer','region','culture','event','story'));

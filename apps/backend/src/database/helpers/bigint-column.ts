import { Column, type ColumnOptions, type ValueTransformer } from "typeorm";

const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | null) => (value == null ? value : value.toString()),
  from: (value?: string | null) => (value == null ? value : BigInt(value)),
};

export function BigIntColumn(options: ColumnOptions = {}): PropertyDecorator {
  return (target, propertyKey) => {
    Column({
      type: "bigint",
      transformer: bigintTransformer,
      ...options,
    })(target, propertyKey as string);

    Reflect.metadata("design:type", String)(target, propertyKey as string);
  };
}

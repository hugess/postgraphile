import {
  makeExtendSchemaPlugin,
  makeAddInflectorsPlugin,
  gql,
  embed,
} from "../";
import {
  buildSchema,
  // defaultPlugins,
  StandardTypesPlugin,
  QueryPlugin,
  MutationPlugin,
  SubscriptionPlugin,
  MutationPayloadQueryPlugin,
} from "graphile-build";
import { graphql, subscribe, parse } from "graphql";
import { $$asyncIterator } from "iterall";

function TestUtils_ExtractScopePlugin(
  hook,
  objectTypeName,
  fieldNameOrCallback,
  possiblyCallback
) {
  const callback =
    typeof fieldNameOrCallback === "function" && !possiblyCallback
      ? fieldNameOrCallback
      : possiblyCallback;
  const fieldName = possiblyCallback && fieldNameOrCallback;
  return builder => {
    builder.hook(hook, (_, build, context) => {
      const { Self } = context;
      const currentObjectTypeName = (Self && Self.name) || _.name;
      const currentFieldName = Self ? context.scope.fieldName : undefined;
      if (
        currentObjectTypeName === objectTypeName &&
        (!fieldName || fieldName === currentFieldName)
      ) {
        callback(context.scope);
      }
      return _;
    });
  };
}

const simplePlugins = [
  StandardTypesPlugin,
  QueryPlugin,
  MutationPlugin,
  SubscriptionPlugin,
  MutationPayloadQueryPlugin,
];

let timerRunning = false;
const resolvers = {
  Query: {
    randomNumber(_query, _args, _context, _info) {
      return 4; // chosen by fair dice roll. guaranteed to be random. xkcd#221
    },
    randomNumbers() {
      return [5, 3, 6];
    },
    echo(_query, args) {
      return args.input;
    },
  },
  Mutation: {
    add(_mutation, args) {
      const { a, b } = args;
      // So this isn't a mutation. Whatever.
      return a + b;
    },
  },
  Subscription: {
    clockTicks: {
      resolve(_subscription, args) {
        const { frequency } = args;
        if (frequency == null) {
          throw new Error("No frequency specified");
        }
        return new Promise(resolve =>
          setTimeout(() => resolve(Date.now()), frequency)
        );
      },
      subscribe(_subscription, args) {
        const { frequency } = args;
        if (frequency == null) {
          throw new Error("No frequency specified");
        }
        const callbackQueue = [];
        const valueQueue = [];
        // In a normal application you'd define timerRunning here:
        //   const timerRunning = true
        // However, in the tests we want access to this variable so I've moved
        // it to the global scope.
        timerRunning = true;
        function addValue(v) {
          if (!timerRunning) {
            return;
          }
          if (callbackQueue.length) {
            const callback = callbackQueue.shift();
            callback({ value: v, done: false });
          } else {
            valueQueue.push(v);
          }
        }
        function nextValue() {
          if (valueQueue.length) {
            return Promise.resolve(valueQueue.shift());
          } else {
            return new Promise(resolve => {
              callbackQueue.push(resolve);
            });
          }
        }
        const interval = setInterval(() => addValue(Date.now()), frequency);
        function stopIterator() {
          if (timerRunning) {
            timerRunning = false;
            clearInterval(interval);
          }
        }
        return {
          next() {
            return timerRunning ? nextValue() : this.return();
          },
          return() {
            stopIterator();
            return Promise.resolve({ value: undefined, done: true });
          },
          throw(error) {
            stopIterator();
            return Promise.reject(error);
          },
          [$$asyncIterator]() {
            return this;
          },
        };
      },
    },
  },
};

it("allows adding a simple type", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Query {
          """
          A random number generated by a fair dice roll.
          """
          randomNumber: Int
        }
      `,
      resolvers,
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data } = await graphql(
    schema,
    `
      {
        randomNumber
      }
    `
  );
  expect(data.randomNumber).toEqual(4);
});

it("allows adding a non-null type", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Query {
          """
          A random number generated by a fair dice roll.
          """
          randomNumber: Int!
        }
      `,
      resolvers,
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data } = await graphql(
    schema,
    `
      {
        randomNumber
      }
    `
  );
  expect(data.randomNumber).toEqual(4);
});

it("allows adding a non-null list of non-null type", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Query {
          """
          Gives a list of numbers that were randomly generated by fair dice roll
          """
          randomNumbers: [Int!]!
        }
      `,
      resolvers,
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data } = await graphql(
    schema,
    `
      {
        randomNumbers
      }
    `
  );
  expect(data.randomNumbers).toEqual([5, 3, 6]);
});

it("accepts an array of typedefs", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: [
        gql`
          extend type Query {
            """
            A random number generated by a fair dice roll.
            """
            randomNumber: Int!
          }
        `,
        gql`
          extend type Query {
            """
            Gives a list of numbers that were randomly generated by fair dice roll
            """
            randomNumbers: [Int!]!
          }
        `,
      ],
      resolvers,
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data } = await graphql(
    schema,
    `
      {
        randomNumber
        randomNumbers
      }
    `
  );
  expect(data.randomNumber).toEqual(4);
  expect(data.randomNumbers).toEqual([5, 3, 6]);
});

it("throws the proper error if an array of typeDefs aren't all DocumentNodes", () => {
  return expect(
    buildSchema([
      ...simplePlugins,
      makeExtendSchemaPlugin(_build => ({
        typeDefs: [
          gql`
            extend type Query {
              """
              A random number generated by a fair dice roll.
              """
              randomNumber: Int!
            }
          `,
          `
            extend type Query {
              """
              Gives a list of numbers that were randomly generated by fair dice roll
              """
              randomNumbers: [Int!]!
            }
          `,
        ],
        resolvers,
      })),
    ])
  ).rejects.toMatchInlineSnapshot(
    `[Error: The first argument to makeExtendSchemaPlugin must be generated by the \`gql\` helper, or be an array of the same.]`
  );
});

it("throws the proper error if a single typeDef isn't a DocumentNode", () => {
  return expect(
    buildSchema([
      ...simplePlugins,
      makeExtendSchemaPlugin(_build => ({
        typeDefs: `
            extend type Query {
              """
              Gives a list of numbers that were randomly generated by fair dice roll
              """
              randomNumbers: [Int!]!
            }
          `,
        resolvers,
      })),
    ])
  ).rejects.toMatchInlineSnapshot(
    `[Error: The first argument to makeExtendSchemaPlugin must be generated by the \`gql\` helper, or be an array of the same.]`
  );
});

it("allows adding a field with arguments", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Query {
          """
          Gives you back what you put in
          """
          echo(input: [Int!]!): [Int!]!
        }
      `,
      resolvers,
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data } = await graphql(
    schema,
    `
      {
        echo(input: [1, 1, 2, 3, 5, 8])
      }
    `
  );
  expect(data.echo).toEqual([1, 1, 2, 3, 5, 8]);
});

it("allows adding a field with arguments named using a custom inflector", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeAddInflectorsPlugin({
      echoFieldName() {
        return this.camelCase("my-custom-echo-field-name");
      },
    }),
    makeExtendSchemaPlugin(build => ({
      typeDefs: gql`
        extend type Query {
          """
          Gives you back what you put in
          """
          ${build.inflection.echoFieldName()}(input: [Int!]!): [Int!]!
        }
      `,
      resolvers: {
        Query: {
          [build.inflection.echoFieldName()]: {
            resolve: resolvers.Query.echo,
          },
        },
      },
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data, errors } = await graphql(
    schema,
    `
      {
        echo: myCustomEchoFieldName(input: [1, 1, 2, 3, 5, 8])
      }
    `
  );
  expect(errors).toBeFalsy();
  expect(data.echo).toEqual([1, 1, 2, 3, 5, 8]);
});

it("supports @scope directive with simple values", async () => {
  let scope;
  function storeScope(_scope) {
    if (scope) {
      throw new Error("Scope already stored!");
    }
    scope = _scope;
  }
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Query {
          """
          Gives you back what you put in
          """
          echo(input: [Int!]!): [Int!]!
            @scope(
              isEchoField: true
              stringTest: "THIS_IS_A_STRING"
              intTest: 42
              floatTest: 3.141592
              nullTest: null
            )
        }
      `,
      resolvers,
    })),
    TestUtils_ExtractScopePlugin(
      "GraphQLObjectType:fields:field",
      "Query",
      "echo",
      storeScope
    ),
  ]);
  expect(scope).toBeTruthy();
  expect(scope.isEchoField).toEqual(true);
  expect(scope.stringTest).toEqual("THIS_IS_A_STRING");
  expect(scope.intTest).toEqual(42);
  expect(scope.floatTest).toEqual(3.141592);
  expect(scope.nullTest).toEqual(null);
  expect(scope).toMatchSnapshot();
  expect(schema).toMatchSnapshot();
  const { data, errors } = await graphql(
    schema,
    `
      {
        echo(input: [1, 1, 2, 3, 5, 8])
      }
    `
  );
  expect(errors).toBeFalsy();
  expect(data.echo).toEqual([1, 1, 2, 3, 5, 8]);
});

it("supports @scope directive with variable value", async () => {
  let scope;
  function storeScope(_scope) {
    if (scope) {
      throw new Error("Scope already stored!");
    }
    scope = _scope;
  }
  const secret = Symbol("test-secret");
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Query {
          """
          Gives you back what you put in
          """
          echo(input: [Int!]!): [Int!]!
            @scope(
              isEchoField: true
              stringTest: "THIS_IS_A_STRING"
              intTest: 42
              floatTest: 3.141592
              nullTest: null
              embedTest: ${embed({
                [secret]: "Fred",
                sub: [[11, 22], [33, 44]],
              })}
            )
        }
      `,
      resolvers,
    })),
    TestUtils_ExtractScopePlugin(
      "GraphQLObjectType:fields:field",
      "Query",
      "echo",
      storeScope
    ),
  ]);
  expect(scope).toBeTruthy();
  expect(scope.isEchoField).toEqual(true);
  expect(scope.stringTest).toEqual("THIS_IS_A_STRING");
  expect(scope.intTest).toEqual(42);
  expect(scope.floatTest).toEqual(3.141592);
  expect(scope.nullTest).toEqual(null);
  expect(scope.embedTest).toBeTruthy();
  expect(scope.embedTest[secret]).toEqual("Fred");
  expect(scope.embedTest.sub[1][1]).toEqual(44);
  expect(scope).toMatchSnapshot();
  expect(schema).toMatchSnapshot();
  const { data, errors } = await graphql(
    schema,
    `
      {
        echo(input: [1, 1, 2, 3, 5, 8])
      }
    `
  );
  expect(errors).toBeFalsy();
  expect(data.echo).toEqual([1, 1, 2, 3, 5, 8]);
});

it("supports defining new types", async () => {
  const inputsSeen = [];
  const enumsSeen = [];
  const EchoCount = gql`
    enum EchoCount {
      ONCE
      TWICE
      FOREVER
    }
  `;

  const EchoInput = gql`
    input EchoInput {
      text: String!
      int: Int
      float: Float!
      count: EchoCount = FOREVER
    }
  `;
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        ${EchoCount}
        ${EchoInput}

        type EchoOutput {
          text: String!
          int: Int
          float: Float!
          count: EchoCount!
        }

        extend input EchoInput {
          intList: [Int!]
        }

        extend type EchoOutput {
          intList: [Int!]
        }

        extend type Query {
          """
          Gives you back what you put in
          """
          echo(input: EchoInput, enum: EchoCount = FOREVER): EchoOutput
        }
      `,
      resolvers: {
        EchoCount: {
          FOREVER: "forever and ever and ever",
        },
        Query: {
          echo: {
            resolve(_query, args) {
              inputsSeen.push(args.input);
              enumsSeen.push(args.enum);
              return args.input;
            },
          },
        },
      },
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data, errors } = await graphql(
    schema,
    `
      {
        t0: echo(input: { text: "Hi0", float: -0.42 }, enum: ONCE) {
          text
          int
          float
          intList
          count
        }
        t1: echo(input: { text: "Hi1", float: 0.23, count: ONCE }) {
          text
          int
          float
          intList
          count
        }
        t2: echo(input: { text: "Hi2", int: 42, float: 1.23, count: TWICE }) {
          text
          int
          float
          intList
          count
        }
        t3: echo(
          input: {
            text: "Hi3"
            int: 88
            float: 2.23
            intList: [99, 22, 33]
            count: FOREVER
          }
        ) {
          text
          int
          float
          intList
          count
        }
      }
    `
  );
  expect(errors).toBeFalsy();
  expect(data).toMatchSnapshot();
  expect(inputsSeen.length).toEqual(4);
  expect(enumsSeen.length).toEqual(4);
  expect(inputsSeen.map(s => s.count)).toEqual([
    "forever and ever and ever",
    "ONCE",
    "TWICE",
    "forever and ever and ever",
  ]);
  expect(enumsSeen).toEqual([
    "ONCE",
    "forever and ever and ever",
    "forever and ever and ever",
    "forever and ever and ever",
  ]);
});

it("supports defining a simple mutation", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Mutation {
          add(a: Int, b: Int): Int
        }
      `,
      resolvers,
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data, errors } = await graphql(
    schema,
    `
      mutation {
        add(a: 101, b: 42)
      }
    `
  );
  expect(errors).toBeFalsy();
  expect(data).toMatchSnapshot();
});

it("supports defining a more complex mutation", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        input EchoInput {
          text: String!
          int: Int
          float: Float!
          intList: [Int!]
        }

        type EchoOutput {
          text: String!
          int: Int
          float: Float!
          intList: [Int!]
        }

        extend type Mutation {
          """
          Gives you back what you put in
          """
          echo(input: EchoInput): EchoOutput
        }
      `,
      resolvers: {
        Mutation: {
          echo: {
            resolve(_query, args) {
              return args.input;
            },
          },
        },
      },
    })),
  ]);
  expect(schema).toMatchSnapshot();
  const { data, errors } = await graphql(
    schema,
    `
      mutation {
        t1: echo(input: { text: "Hi1", float: 0.23 }) {
          text
          int
          float
          intList
        }
        t2: echo(input: { text: "Hi2", int: 42, float: 1.23 }) {
          text
          int
          float
          intList
        }
        t3: echo(
          input: { text: "Hi3", int: 88, float: 2.23, intList: [99, 22, 33] }
        ) {
          text
          int
          float
          intList
        }
      }
    `
  );
  expect(errors).toBeFalsy();
  expect(data).toMatchSnapshot();
});

it("supports defining a simple subscription", async () => {
  const schema = await buildSchema([
    ...simplePlugins,
    makeExtendSchemaPlugin(_build => ({
      typeDefs: gql`
        extend type Subscription {
          clockTicks(
            """
            How frequently to fire a clock tick (milliseconds)
            """
            frequency: Int = 100
          ): Float
        }
      `,
      resolvers,
    })),
  ]);
  expect(schema).toMatchSnapshot();

  // Let's do a standard resolve:
  let before = Date.now();
  expect(timerRunning).toBeFalsy();
  const { data, errors } = await graphql(
    schema,
    `
      subscription {
        clockTicks
      }
    `
  );
  let after = Date.now();
  expect(after).toBeGreaterThanOrEqual(before + 100);
  expect(errors).toBeFalsy();
  expect(data.clockTicks).toBeGreaterThanOrEqual(before);
  expect(data.clockTicks).toBeLessThanOrEqual(after);
  expect(timerRunning).toBeFalsy();

  // Now lets try subscribing:
  before = Date.now();
  const iterator = await subscribe(
    schema,
    parse(`
      subscription {
        clockTicks(frequency: 50)
      }
    `)
  );
  after = Date.now();

  // expect(iterator).toBeInstanceOf(AsyncIterator);
  expect(iterator.errors).toBeFalsy();
  expect(timerRunning).toBeTruthy();

  // Lets get the next 5 values
  let lastTick = before;
  for (let i = 0; i < 5; i++) {
    const { value, done } = await iterator.next();
    expect(done).toBeFalsy();
    const { data, errors } = value;
    expect(errors).toBeFalsy();
    const currentTick = data.clockTicks;
    expect(currentTick).toBeTruthy();
    expect(currentTick).toBeGreaterThanOrEqual(lastTick + 49);
    lastTick = currentTick;
  }
  expect(timerRunning).toBeTruthy();

  // And now stop the iterator
  await iterator.return();
  expect(timerRunning).toBeFalsy();
  const { value, done } = await iterator.next();
  expect(done).toBeTruthy();
  expect(value).toBe(undefined);
});
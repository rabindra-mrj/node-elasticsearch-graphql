import { makeExecutableSchema } from 'graphql-tools';
import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';
import fetch from 'node-fetch';

const ELASTIC_HOST = "localhost:9200";

var schema = `
type Author {
  id: Int! # the ! means that every author object _must_ have an id
  firstName: String
  lastName: String
  posts: [Post] # the list of Posts by this author
}

type Post {
  id: Int!
  title: String
  author: Author
  votes: Int
}

# the schema allows the following query:
type Query {
  posts: [Post]
}

# we need to tell the server which types represent the root query
# and root mutation types. We call them RootQuery and RootMutation by convention.
schema {
  query: Query
}
`;

const resolveFunctions = {
  Query: {
    posts() {
      return [{ id: 1, title: "post 1", author: { id: 1, firstName: "author1" } }];
    },
  },
  Author: {
    posts(author) {
      return { id: 1, title: "post 1", author: { id: 1, firstName: "author1" } };
    },
  },
  Post: {
    author(post) {
      return { id: 1, firstName: "author1" };
    },
  },
};

const executableSchema = makeExecutableSchema({
  typeDefs: schema,
  resolvers: resolveFunctions,
});

var elasticTypeToGraphQLType = { 'text': 'String', 'float': 'Float', 'long': 'Int', 'boolean': 'Boolean', 'date': 'Date' };

class TypeBuilder {
  private typeInfo;
  resolver;
  constructor(private typeName, properties) {
    this.typeInfo = { typeName, properties };
  }
  get name() {
    return this.typeInfo.typeName;
  }
  build() {
    var lines = [`type ${this.name} {`];
    this.resolver = {};
    for (let field in this.typeInfo.properties) {
      this.resolver[field] = () => {

      }
      let prop = this.typeInfo.properties[field];
      if (!field.startsWith("@")) {
        let fieldType = elasticTypeToGraphQLType[prop.type] || prop.type;
        lines.push(`\t${field}:${fieldType}`);
      }
    }
    lines.push(`}`);
    return lines.join('\n');
  }
}

var SchemaBuilder = function (rootName) {
  var queryTypeProps = {};
  var typeBuilders: TypeBuilder[] = [];
  var resolver = {};
  return {
    getResolver() {
      return resolver;
    },
    addType(builder: TypeBuilder) {
      typeBuilders.push(builder);
    },
    build() {
      var lines = [];
      for (let builder of typeBuilders) {
        var name = builder.name;
        queryTypeProps['all_' + name] = { type: name + '_Collection' };
        queryTypeProps['get_' + name] = { type: name + '_Info' };
        lines.push(builder.build());
      }
      var queryTypeBuilder = new TypeBuilder(rootName, queryTypeProps);
      lines.push(queryTypeBuilder.build());
      resolver[rootName] = queryTypeBuilder.resolver;
      lines.push(`schema { query: ${rootName} }`);

      return lines.join('\n');
    }
  };
};

(async function () {
  var response = await fetch(`http://${ELASTIC_HOST}/_cat/indices?h=index,store.size,health&bytes=k&format=json`);
  var result = await response.json();
  var schemaBuilder = SchemaBuilder('Query');
  for (let indexInfo of result) {
    let mappingsInfo = await (await fetch(`http://${ELASTIC_HOST}/${indexInfo.index}/_mapping`)).json();
    let mappingInfo = mappingsInfo[indexInfo.index];
    for (let type in mappingInfo.mappings) {
      let typeName = indexInfo.index + ((type != 'logs') ? `_${type}` : '');
      schemaBuilder.addType(new TypeBuilder(typeName, mappingInfo.mappings[type].properties));
    }
  }
  var schema = schemaBuilder.build();
  console.log(schemaBuilder.getResolver());
})();

const app = express();
app.use('/graphql', graphqlHTTP({
  schema: executableSchema,
  graphiql: true,
}));
app.listen(4000, () => console.log('Now browse to localhost:4000/graphql'));
import { makeExecutableSchema } from 'graphql-tools';
import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';
import fetch from 'node-fetch';
import GraphQLDateType from "./graphql-type-date";
import GraphQLJSONType from "./graphql-type-json";


const ELASTIC_HOST = "localhost:9200";

var elasticTypeToGraphQLType = { 'text': 'String', 'float': 'Float', 'long': 'Int', 'boolean': 'Boolean', 'date': 'Date' };

class TypeBuilder {
    private typeInfo;

    constructor(public index, public type, public isRoot, properties) {
        let typeName = index + ((type != 'logs' && type) ? `_${type}` : '');
        this.typeInfo = { typeName, properties };
    }
    get name() {
        return this.typeInfo.typeName;
    }
    build() {
        var lines = [`type ${this.name} {`];

        for (let field in this.typeInfo.properties) {
            let prop = this.typeInfo.properties[field];
            if (!field.startsWith("@")) {
                let fieldType = elasticTypeToGraphQLType[prop.type] || prop.type;
                if (prop.args && prop.args.length > 0) {
                    var args = prop.args.map(arg => arg.name + ":" + arg.type).join(',');

                    lines.push(`\t ${field}(${args}):${fieldType}`);
                } else {
                    lines.push(`\t ${field}:${fieldType}`);
                }
            }
        }
        lines.push(`}`);

        if (!this.isRoot) {
            //collection types:
            lines.push(`type ${this.name}_Collection {`);
            lines.push(`\t size: Int`);
            lines.push(`\t from: Int`);
            lines.push(`\t totalCount: Int`);
            lines.push(`\t hitCount: Int`);
            lines.push(`\t data: [${this.name}]`);
            lines.push(`}`);
        }

        return lines.join('\n');
    }
}

var indexSearchResolver = function(indexName, typeName) {
    return async function(root, args, context, info) {
        args = args || {};
        args.esQuery = args.esQuery || { query: { match_all: {} } };
        context = context || {};
        info = info || {};

        var esQuery = args.esQuery;
        let path = indexName + '/' + ((typeName != 'logs' && typeName) ? `_${typeName}/` : '');
        let data = await (await fetch(`http://${ELASTIC_HOST}/${path}_search`, {
            headers: { "Content-Type": "application/json" },
            method: 'POST',
            body: JSON.stringify(esQuery)
        })).json();
        return { from: args.esQuery.from, size: args.esQuery.size, hitCount: data.hits.hits.length, totalCount: data.hits.total, data: data.hits.hits.map(hit => hit._source) };
    };
}

var indexGetResolver = function(indexName, typeName) {
    return async function(root, args, context, info) {
        console.log("resolving");
        args = args || {};
        var id = args.id;
        // throw exception if no id??
        context = context || {};
        info = info || {};

        var esQuery = { match: { _id: id } };
        let path = indexName + '/' + ((typeName != 'logs' && typeName) ? `_${typeName}/` : '');
        let data = await (await fetch(`http://${ELASTIC_HOST}/${path}_search?q=_id:${id}`)).json();

        var result = data.hits.hits.map(hit => hit._source)[0]; 
        if(!result)
          throw new Error("No suc data found");
        return result;
    };
}

var SchemaBuilder = function(rootName) {
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
            var fieldResolver = {};
            for (let builder of typeBuilders) {
                var name = builder.name;
                queryTypeProps['all_' + name] = { type: name + '_Collection', args: [{ name: 'esQuery', type: 'JSON' }] };
                queryTypeProps['get_' + name] = { type: name, args: [{ name: 'id', type: 'Int' }] };
                lines.push(builder.build());
                fieldResolver[`all_${name}`] = indexSearchResolver(builder.index, builder.type);
                fieldResolver[`get_${name}`] = indexGetResolver(builder.index, builder.type);
            }
            var queryTypeBuilder = new TypeBuilder(rootName, "", true, queryTypeProps);
            lines.push(queryTypeBuilder.build());
            resolver[rootName] = fieldResolver;
            lines.push(`schema { query: ${rootName} }`);
            return lines.join('\n');
        }
    };
};

const app = express();

(async function() {
    var response = await fetch(`http://${ELASTIC_HOST}/_cat/indices?h=index,store.size,health&bytes=k&format=json`);
    var result = await response.json();
    var schemaBuilder = SchemaBuilder('Query');
    for (let indexInfo of result) {
        let mappingsInfo = await (await fetch(`http://${ELASTIC_HOST}/${indexInfo.index}/_mapping`)).json();
        let mappingInfo = mappingsInfo[indexInfo.index];
        for (let type in mappingInfo.mappings) {
            schemaBuilder.addType(new TypeBuilder(indexInfo.index, type, false, mappingInfo.mappings[type].properties));
        }
    }


    var schemaDeclaration = `scalar Date
    scalar JSON
    ${schemaBuilder.build()}`;

    var resolver = schemaBuilder.getResolver();
    (<any>resolver).Date = GraphQLDateType;
    (<any>resolver).JSON = GraphQLJSONType;

    var executableSchema = makeExecutableSchema({
        typeDefs: schemaDeclaration,
        resolvers: resolver,
    });

    app.use('/graphql', graphqlHTTP({
        schema: executableSchema,
        graphiql: true,
    }));
    console.log("Now browse to localhost:4000/graphql")
})().catch(e => console.log(e));


app.listen(4000, () => console.log('Server started'));